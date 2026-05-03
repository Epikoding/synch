import { beforeEach, describe, expect, it, vi } from "vitest";

import { Plugin, resetObsidianMocks } from "../test-stubs/obsidian";
import { DEFAULT_SYNC_FILE_RULES } from "../sync/core/file-rules";
import { SyncController } from "../sync/runtime/controller";
import { SYNCH_SETTINGS_KEY, type SynchPluginSettings } from "../settings/schema";
import { SynchPluginController } from "./plugin-controller";

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
    const plugin = createPluginWithSettings({
      apiBaseUrl: "http://127.0.0.1:8787",
      fileRules: DEFAULT_SYNC_FILE_RULES,
      syncEnabled: false,
    });
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
