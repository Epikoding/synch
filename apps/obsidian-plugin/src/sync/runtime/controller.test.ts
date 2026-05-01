import { afterEach, describe, expect, it, vi } from "vitest";

import type { SyncTokenResponse } from "../remote/client";
import { createTestPlugin } from "../../test-support/test-plugin";
import { SyncController } from "./controller";
import { SyncEngine } from "./engine";

describe("SyncController", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("schedules a push on startup when persisted pending mutations remain", async () => {
    const reconcileOnce = vi.spyOn(SyncEngine.prototype, "reconcileOnce").mockResolvedValue({
      filesScanned: 1,
      filesQueuedForUpsert: 0,
      filesQueuedForDelete: 0,
    });
    const unblockQuotaBlockedMutations = vi
      .spyOn(SyncEngine.prototype, "unblockQuotaBlockedMutations")
      .mockResolvedValue();
    const hasPendingMutations = vi
      .spyOn(SyncEngine.prototype, "hasPendingMutations")
      .mockResolvedValue(true);
    const startAutoSync = vi
      .spyOn(SyncEngine.prototype, "startAutoSync")
      .mockResolvedValue(true);
    const notifyLocalChange = vi
      .spyOn(SyncEngine.prototype, "notifyLocalChange")
      .mockImplementation(() => {});

    const controller = new SyncController(createDeps());

    await controller.ensureAutoSyncState();

    expect(startAutoSync).toHaveBeenCalledTimes(1);
    expect(unblockQuotaBlockedMutations).toHaveBeenCalledTimes(1);
    expect(notifyLocalChange).toHaveBeenCalledTimes(1);
    expect(reconcileOnce.mock.invocationCallOrder[0]).toBeLessThan(
      unblockQuotaBlockedMutations.mock.invocationCallOrder[0] ?? 0,
    );
    expect(unblockQuotaBlockedMutations.mock.invocationCallOrder[0]).toBeLessThan(
      hasPendingMutations.mock.invocationCallOrder[0] ?? 0,
    );
    expect(startAutoSync.mock.invocationCallOrder[0]).toBeLessThan(
      notifyLocalChange.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("does not schedule a startup push when reconcile found no changes and nothing is pending", async () => {
    vi.spyOn(SyncEngine.prototype, "reconcileOnce").mockResolvedValue({
      filesScanned: 1,
      filesQueuedForUpsert: 0,
      filesQueuedForDelete: 0,
    });
    vi.spyOn(SyncEngine.prototype, "hasPendingMutations").mockResolvedValue(false);
    vi.spyOn(SyncEngine.prototype, "startAutoSync").mockResolvedValue(true);
    const notifyLocalChange = vi
      .spyOn(SyncEngine.prototype, "notifyLocalChange")
      .mockImplementation(() => {});

    const controller = new SyncController(createDeps());

    await controller.ensureAutoSyncState();

    expect(notifyLocalChange).toHaveBeenCalledTimes(0);
  });

  it("resumes an already active auto sync loop without forcing reconnect", async () => {
    vi.spyOn(SyncEngine.prototype, "hasStore").mockReturnValue(true);
    vi.spyOn(SyncEngine.prototype, "startAutoSync").mockResolvedValue(false);
    const resumeAutoSyncConnection = vi
      .spyOn(SyncEngine.prototype, "resumeAutoSyncConnection")
      .mockResolvedValue();
    const reconnectAutoSync = vi
      .spyOn(SyncEngine.prototype, "reconnectAutoSync")
      .mockImplementation(() => {});

    const controller = new SyncController(createDeps());

    await controller.resumeAutoSync();

    expect(resumeAutoSyncConnection).toHaveBeenCalledTimes(1);
    expect(reconnectAutoSync).not.toHaveBeenCalled();
  });

  it("starts auto sync on resume when the loop is not active", async () => {
    vi.spyOn(SyncEngine.prototype, "hasStore").mockReturnValue(true);
    const startAutoSync = vi
      .spyOn(SyncEngine.prototype, "startAutoSync")
      .mockResolvedValue(true);
    const resumeAutoSyncConnection = vi
      .spyOn(SyncEngine.prototype, "resumeAutoSyncConnection")
      .mockResolvedValue();

    const controller = new SyncController(createDeps());

    await controller.resumeAutoSync();

    expect(startAutoSync).toHaveBeenCalledTimes(1);
    expect(resumeAutoSyncConnection).not.toHaveBeenCalled();
  });
});

function createDeps(): ConstructorParameters<typeof SyncController>[0] {
  return {
    plugin: createTestPlugin(),
    getApiBaseUrl: () => "http://127.0.0.1:8787",
    getSyncToken: async () => createToken(),
    invalidateSyncToken: vi.fn(),
    getRemoteVaultKey: () => new Uint8Array(32),
    getSyncFileRules: () => ({
      includeGlobs: [],
      excludeGlobs: [],
      maxFileBytes: 10_000_000,
    }),
    hasActiveRemoteVaultSession: () => true,
    hasAuthenticatedSession: () => true,
    notifyError: vi.fn(),
  };
}

function createToken(): SyncTokenResponse {
  return {
    token: "sync-token",
    expiresAt: 1_000,
    vaultId: "vault-1",
    localVaultId: "local-vault-1",
  };
}
