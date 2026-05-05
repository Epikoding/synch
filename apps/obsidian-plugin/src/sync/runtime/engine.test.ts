import type { Plugin, TFile } from "obsidian";
import { TFile as ObsidianTFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { encodeUtf8, hashBytes } from "../core/content";
import { DEFAULT_SYNC_FILE_RULES } from "../core/file-rules";
import { queueLocalUpsertMutation } from "../core/mutation-queue";
import type { SyncTokenResponse } from "../remote/client";
import { createInitializedTestSyncStore } from "../../test-support/test-plugin";
import { SyncEngine } from "./engine";

type VaultEventCallback = (...args: unknown[]) => void;

const TEST_VAULT_KEY = new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1));

describe("SyncEngine", () => {
  it("reports offline sync startup failures through status without a notice", async () => {
    const plugin = createPlugin({}, async () => encodeUtf8("body"));
    const store = await createInitializedTestSyncStore(plugin);
    const setSyncStatus = vi.fn();
    const notifyError = vi.fn();
    const engine = createEngine(plugin, {
      getSyncToken: async () => {
        throw new Error("offline");
      },
      setSyncStatus,
      notifyError,
    });
    engine.setStore(store);

    await engine.startAutoSync();

    expect(setSyncStatus).toHaveBeenCalledWith("offline");
    expect(notifyError).not.toHaveBeenCalled();
    engine.stopAutoSync();
    await store.close();
  });

  it("lists file-size blocked files with decrypted paths and size metadata", async () => {
    const plugin = createPlugin({}, async () => encodeUtf8("body"));
    const store = await createInitializedTestSyncStore(plugin);
    const fileSizeBlocked = await queueLocalUpsertMutation(store, {
      remoteVaultKey: TEST_VAULT_KEY,
      path: "Folder/large.md",
      entryId: "entry-large",
      base: null,
      hash: "hash-large",
    });
    await store.updateDirtyEntry({
      ...fileSizeBlocked.mutation,
      status: "blocked",
      blockedReason: "file_too_large",
      blockedEncryptedSizeBytes: 12_400_000,
      blockedMaxFileSizeBytes: 10_000_000,
    });
    const engine = createEngine(plugin);
    engine.setStore(store);

    await expect(engine.listFileSizeBlockedFiles()).resolves.toEqual([
      {
        path: "Folder/large.md",
        encryptedSizeBytes: 12_400_000,
        maxFileSizeBytes: 10_000_000,
      },
    ]);
    await store.close();
  });

  it("returns no file-size blocked files when the store is not initialized", async () => {
    const plugin = createPlugin({}, async () => encodeUtf8("body"));
    const engine = createEngine(plugin);

    await expect(engine.listFileSizeBlockedFiles()).resolves.toEqual([]);
  });

  it("does not let baseline progress overwrite an active pull", async () => {
    const plugin = createPlugin({}, async () => encodeUtf8("body"));
    const store = await createInitializedTestSyncStore(plugin);
    await store.upsertEntry({
      entryId: "entry-synced",
      path: "synced.md",
      revision: 1,
      blobId: "blob-synced",
      hash: "hash-synced",
      deleted: false,
      updatedAt: 1,
      localMtime: null,
      localSize: null,
    });
    const setSyncProgress = vi.fn();
    const engine = createEngine(plugin, { setSyncProgress });
    engine.setStore(store);
    const activityEngine = engine as unknown as {
      withSyncActivity<T>(kind: "pull", work: () => Promise<T>): Promise<T>;
      reportActivityProgress(progress: {
        completedEntries: number;
        totalEntries: number;
      }): void;
    };

    await activityEngine.withSyncActivity("pull", async () => {
      activityEngine.reportActivityProgress({
        completedEntries: 0,
        totalEntries: 4000,
      });
      await engine.refreshSyncProgress();
      activityEngine.reportActivityProgress({
        completedEntries: 100,
        totalEntries: 4000,
      });
    });

    expect(setSyncProgress.mock.calls.map(([progress]) => progress)).toEqual([
      {
        completedEntries: 0,
        totalEntries: 4000,
      },
      {
        completedEntries: 100,
        totalEntries: 4000,
      },
      {
        completedEntries: 1,
        totalEntries: 1,
      },
    ]);
    await store.close();
  });

  it("keeps pull progress active when overlapping local work finishes first", async () => {
    const plugin = createPlugin({}, async () => encodeUtf8("body"));
    const store = await createInitializedTestSyncStore(plugin);
    await store.upsertEntry({
      entryId: "entry-synced",
      path: "synced.md",
      revision: 1,
      blobId: "blob-synced",
      hash: "hash-synced",
      deleted: false,
      updatedAt: 1,
      localMtime: null,
      localSize: null,
    });
    const setSyncProgress = vi.fn();
    const engine = createEngine(plugin, { setSyncProgress });
    engine.setStore(store);
    const activityEngine = engine as unknown as {
      withSyncActivity<T>(
        kind: "local" | "pull",
        work: () => Promise<T>,
      ): Promise<T>;
      reportActivityProgress(progress: {
        completedEntries: number;
        totalEntries: number;
      }): void;
    };
    const releaseLocal = createDeferred<void>();
    const releasePull = createDeferred<void>();

    const local = activityEngine.withSyncActivity("local", async () => {
      await releaseLocal.promise;
    });
    const pull = activityEngine.withSyncActivity("pull", async () => {
      activityEngine.reportActivityProgress({
        completedEntries: 0,
        totalEntries: 4000,
      });
      await releasePull.promise;
    });
    await nextTask();

    releaseLocal.resolve();
    await local;
    await engine.refreshSyncProgress();
    activityEngine.reportActivityProgress({
      completedEntries: 100,
      totalEntries: 4000,
    });
    releasePull.resolve();
    await pull;

    expect(setSyncProgress.mock.calls.map(([progress]) => progress)).toEqual([
      {
        completedEntries: 0,
        totalEntries: 4000,
      },
      {
        completedEntries: 100,
        totalEntries: 4000,
      },
      {
        completedEntries: 1,
        totalEntries: 1,
      },
    ]);
    await store.close();
  });

  it("serializes vault event recording behind an active reconcile", async () => {
    const firstRead = createDeferred<Uint8Array>();
    const callbacks: Partial<Record<"modify", VaultEventCallback>> = {};
    let readCalls = 0;
    const plugin = createPlugin(callbacks, async () => {
      readCalls += 1;
      if (readCalls === 1) {
        return await firstRead.promise;
      }

      return encodeUtf8("new");
    });
    const store = await createInitializedTestSyncStore(plugin);
    const engine = new SyncEngine({
      plugin,
      getApiBaseUrl: () => "http://127.0.0.1:8787",
      getSyncToken: async () => createToken(),
      invalidateSyncToken: vi.fn(),
      getRemoteVaultKey: () => TEST_VAULT_KEY,
      getSyncFileRules: () => DEFAULT_SYNC_FILE_RULES,
      hasActiveRemoteVaultSession: () => true,
      notify: vi.fn(),
      notifyError: vi.fn(),
      notifySyncConflict: vi.fn(),
      setSyncProgress: vi.fn(),
      setSyncStatus: vi.fn(),
      setStorageStatus: vi.fn(),
    });
    engine.setStore(store);
    engine.registerVaultEvents();

    const reconcilePromise = engine.reconcileOnce();
    await nextTask();
    callbacks.modify?.(createFile("note.md"));
    await nextTask();

    expect(readCalls).toBe(1);

    firstRead.resolve(encodeUtf8("old"));
    await reconcilePromise;
    await eventually(async () => {
      expect(readCalls).toBe(2);
      const pending = await store.listDirtyEntries();
      expect(pending).toHaveLength(1);
      expect(pending[0]?.hash).toBe(await hashBytes(encodeUtf8("new")));
    });
    await store.close();
  });

});

function createEngine(
  plugin: Plugin,
  overrides: Partial<SyncEngineDepsForTest> = {},
): SyncEngine {
  return new SyncEngine({
    plugin,
    getApiBaseUrl: () => "http://127.0.0.1:8787",
    getSyncToken: async () => createToken(),
    invalidateSyncToken: vi.fn(),
    getRemoteVaultKey: () => TEST_VAULT_KEY,
    getSyncFileRules: () => DEFAULT_SYNC_FILE_RULES,
    hasActiveRemoteVaultSession: () => true,
    notify: vi.fn(),
    notifyError: vi.fn(),
    notifySyncConflict: vi.fn(),
    setSyncProgress: vi.fn(),
    setSyncStatus: vi.fn(),
    setStorageStatus: vi.fn(),
    ...overrides,
  });
}

type SyncEngineDepsForTest = ConstructorParameters<typeof SyncEngine>[0];

function createPlugin(
  callbacks: Partial<Record<"modify", VaultEventCallback>>,
  readBinary: () => Promise<Uint8Array>,
): Plugin {
  const localStorage = new Map<string, unknown>();
  const directories = new Set([".obsidian/plugins/synch"]);
  const files = new Map<string, string | Uint8Array>();

  return {
    manifest: {
      dir: ".obsidian/plugins/synch",
    },
    registerEvent: vi.fn(),
    app: {
      loadLocalStorage(key: string): unknown | null {
        return localStorage.get(key) ?? null;
      },
      saveLocalStorage(key: string, value: unknown | null): void {
        if (value === null) {
          localStorage.delete(key);
          return;
        }

        localStorage.set(key, value);
      },
      vault: {
        getFiles: vi.fn(() => [createFile("note.md")]),
        readBinary: vi.fn(async () => toArrayBuffer(await readBinary())),
        on: vi.fn((eventName: string, callback: VaultEventCallback) => {
          if (eventName === "modify") {
            callbacks.modify = callback;
          }
          return {};
        }),
        adapter: {
          async exists(path: string): Promise<boolean> {
            return directories.has(path) || files.has(path);
          },
          async read(path: string): Promise<string> {
            const file = files.get(path);
            if (typeof file !== "string") {
              throw new Error(`missing test file: ${path}`);
            }

            return file;
          },
          async readBinary(path: string): Promise<ArrayBuffer> {
            const file = files.get(path);
            if (!(file instanceof Uint8Array)) {
              throw new Error(`missing test file: ${path}`);
            }

            return toArrayBuffer(file);
          },
          async write(path: string, value: string): Promise<void> {
            files.set(path, value);
          },
          async writeBinary(path: string, value: ArrayBuffer): Promise<void> {
            files.set(path, new Uint8Array(value));
          },
          async remove(path: string): Promise<void> {
            files.delete(path);
          },
          async mkdir(path: string): Promise<void> {
            directories.add(path);
          },
        },
      },
    },
    async loadData(): Promise<unknown> {
      return null;
    },
    async saveData(): Promise<void> {},
  } as unknown as Plugin;
}

function createToken(): SyncTokenResponse {
  return {
    token: "sync-token",
    expiresAt: 1_000,
    vaultId: "vault-1",
    localVaultId: "local-vault-1",
    syncFormatVersion: 1,
  };
}

function createFile(path: string): TFile {
  const file = new ObsidianTFile(path) as TFile;
  file.stat = {
    ctime: 1,
    mtime: 1,
    size: 3,
  };
  return file;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((next) => {
    resolve = next;
  });

  return { promise, resolve };
}

async function eventually(assertion: () => Promise<void>): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await nextTask();
    }
  }

  throw lastError;
}

async function nextTask(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
