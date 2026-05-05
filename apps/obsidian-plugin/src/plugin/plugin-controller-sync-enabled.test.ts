import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getNotices,
  Plugin,
  resetObsidianMocks,
  setRequestUrlMock,
} from "../test-stubs/obsidian";
import { DEFAULT_SYNC_FILE_RULES } from "../sync/core/file-rules";
import { SyncController } from "../sync/runtime/controller";
import { SYNCH_SETTINGS_KEY, type SynchPluginSettings } from "../settings/schema";
import { SynchPluginController } from "./plugin-controller";
import {
  createConnectedPlugin,
  mockOnlineReadinessRequests,
  storedConnection,
} from "./__tests__/readiness-helpers";

const TestPlugin = Plugin as unknown as new () => Plugin;

describe("SynchPluginController sync enabled setting", () => {
  beforeEach(() => {
    resetObsidianMocks();
    vi.restoreAllMocks();
  });

  it("does not start auto sync when persisted sync is disabled", async () => {
    const plugin = createPluginWithSettings({
      apiBaseUrl: "http://127.0.0.1:8787",
      fileRules: DEFAULT_SYNC_FILE_RULES,
      syncEnabled: false,
    });
    const ensureAutoSyncState = vi
      .spyOn(SyncController.prototype, "ensureAutoSyncState")
      .mockResolvedValue();
    const stopAutoSyncAndMarkPaused = vi
      .spyOn(SyncController.prototype, "stopAutoSyncAndMarkPaused")
      .mockImplementation(() => {});
    const controller = new SynchPluginController({
      plugin,
      refreshUi: vi.fn(),
    });
    await controller.initialize();

    await controller.ensureAutoSyncState();

    expect(ensureAutoSyncState).not.toHaveBeenCalled();
    expect(stopAutoSyncAndMarkPaused).toHaveBeenCalledTimes(1);
  });

  it("starts the existing auto sync flow when sync is enabled", async () => {
    const plugin = await createConnectedPlugin({
      syncEnabled: false,
    });
    mockOnlineReadinessRequests();
    vi.spyOn(SyncController.prototype, "readStoredConnection").mockResolvedValue(
      storedConnection(),
    );
    vi.spyOn(SyncController.prototype, "initializeStore").mockResolvedValue();
    const ensureAutoSyncState = vi
      .spyOn(SyncController.prototype, "ensureAutoSyncState")
      .mockResolvedValue();
    const refreshUi = vi.fn();
    const controller = new SynchPluginController({
      plugin,
      refreshUi,
    });
    await controller.initialize();

    await controller.setSyncEnabled(true);

    expect(ensureAutoSyncState).toHaveBeenCalledTimes(1);
    expect(refreshUi).toHaveBeenCalled();
    expect(plugin.savedData?.[SYNCH_SETTINGS_KEY]).toMatchObject({
      syncEnabled: true,
    });
  });

  it("does not enable sync when the server requires a plugin update", async () => {
    const plugin = createPluginWithSettings({
      apiBaseUrl: "http://127.0.0.1:8787",
      fileRules: DEFAULT_SYNC_FILE_RULES,
      syncEnabled: false,
    });
    setRequestUrlMock(
      vi.fn(async () => ({
        status: 200,
        json: {
          status: "update_required",
          minVersion: "1.2.0",
          message: "Update Synch before syncing.",
        },
      })),
    );
    const ensureAutoSyncState = vi
      .spyOn(SyncController.prototype, "ensureAutoSyncState")
      .mockResolvedValue();
    const stopAutoSyncAndMarkNotReady = vi
      .spyOn(SyncController.prototype, "stopAutoSyncAndMarkNotReady")
      .mockImplementation(() => {});
    const refreshUi = vi.fn();
    const controller = new SynchPluginController({
      plugin,
      refreshUi,
    });
    await controller.initialize();

    expect(controller.getSyncState()).toBe("update_required");
    expect(controller.getSyncStatusLabel()).toBe("Plugin update required.");
    expect(getNotices()).toContainEqual({
      message: "Update Synch before syncing.",
      timeout: 0,
    });

    await controller.setSyncEnabled(true);
    await controller.ensureAutoSyncState();

    expect(controller.getPluginUpdateStatus()).toEqual({
      state: "update_required",
      currentVersion: "0.0.1",
      minVersion: "1.2.0",
      message: "Update Synch before syncing.",
    });
    expect(ensureAutoSyncState).not.toHaveBeenCalled();
    expect(stopAutoSyncAndMarkNotReady).toHaveBeenCalled();
    expect(controller.isSyncEnabled()).toBe(false);
    expect(refreshUi).toHaveBeenCalled();
    expect(getNotices().filter((notice) => notice.message === "Update Synch before syncing."))
      .toHaveLength(2);
  });

  it("stops auto sync and persists disabled state when sync is disabled", async () => {
    const plugin = createPluginWithSettings({
      apiBaseUrl: "http://127.0.0.1:8787",
      fileRules: DEFAULT_SYNC_FILE_RULES,
      syncEnabled: true,
    });
    const stopAutoSyncAndMarkPaused = vi
      .spyOn(SyncController.prototype, "stopAutoSyncAndMarkPaused")
      .mockImplementation(() => {});
    const refreshUi = vi.fn();
    const controller = new SynchPluginController({
      plugin,
      refreshUi,
    });
    await controller.initialize();

    await controller.setSyncEnabled(false);

    expect(stopAutoSyncAndMarkPaused).toHaveBeenCalledTimes(1);
    expect(refreshUi).toHaveBeenCalled();
    expect(plugin.savedData?.[SYNCH_SETTINGS_KEY]).toMatchObject({
      syncEnabled: false,
    });
  });

  it("persists disabled sync when storage quota is exceeded", async () => {
    const plugin = createPluginWithSettings({
      apiBaseUrl: "http://127.0.0.1:8787",
      fileRules: DEFAULT_SYNC_FILE_RULES,
      syncEnabled: true,
    });
    const stopAutoSyncAndMarkPaused = vi
      .spyOn(SyncController.prototype, "stopAutoSyncAndMarkPaused")
      .mockImplementation(() => {});
    const refreshUi = vi.fn();
    const controller = new SynchPluginController({
      plugin,
      refreshUi,
    });
    await controller.initialize();

    const { syncController } = controller as unknown as {
      syncController: {
        deps: {
          onStorageQuotaExceeded: () => Promise<void>;
        };
      };
    };
    await syncController.deps.onStorageQuotaExceeded();

    expect(stopAutoSyncAndMarkPaused).toHaveBeenCalledTimes(1);
    expect(refreshUi).toHaveBeenCalled();
    expect(plugin.savedData?.[SYNCH_SETTINGS_KEY]).toMatchObject({
      syncEnabled: false,
    });
  });
});

function createPluginWithSettings(settings: SynchPluginSettings): Plugin & {
  savedData: Record<string, unknown> | null;
} {
  const plugin = new TestPlugin() as Plugin & {
    savedData: Record<string, unknown> | null;
  };
  plugin.savedData = null;
  plugin.loadData = async () => ({
    [SYNCH_SETTINGS_KEY]: settings,
  });
  plugin.saveData = async (value: unknown) => {
    plugin.savedData = value as Record<string, unknown>;
  };
  return plugin;
}
