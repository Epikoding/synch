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

  it("shows offline instead of not ready when a stored vault cannot activate offline", async () => {
    const notifyError = vi.fn();
    const controller = new SyncController(
      createDeps({
        hasActiveRemoteVaultSession: () => false,
        hasConnectedRemoteVault: () => true,
        isOffline: () => true,
        notifyError,
      }),
    );

    await controller.ensureAutoSyncState();

    expect(controller.getSyncState()).toBe("offline");
    expect(controller.getSyncStatusLabel()).toBe("Sync: offline 0%");
    expect(notifyError).not.toHaveBeenCalled();
  });

  it("preserves offline while a stored vault is still inactive", async () => {
    const controller = new SyncController(
      createDeps({
        hasActiveRemoteVaultSession: () => false,
        hasConnectedRemoteVault: () => true,
        isOffline: () => false,
      }),
    );
    controller.markOffline();

    await controller.ensureAutoSyncState();

    expect(controller.getSyncState()).toBe("offline");
  });

  it("keeps attention needed when an inactive stored vault had a non-offline failure", async () => {
    const controller = new SyncController(
      createDeps({
        hasActiveRemoteVaultSession: () => false,
        hasConnectedRemoteVault: () => true,
        isOffline: () => false,
      }),
    );
    controller.markOffline();
    controller.markAttentionNeeded();

    await controller.resumeAutoSync();

    expect(controller.getSyncState()).toBe("attention_needed");
  });
});

function createDeps(
  overrides: Partial<ConstructorParameters<typeof SyncController>[0]> = {},
): ConstructorParameters<typeof SyncController>[0] {
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
    hasConnectedRemoteVault: () => true,
    hasAuthenticatedSession: () => true,
    notifyError: vi.fn(),
    ...overrides,
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
