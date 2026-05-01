import { Plugin } from "obsidian";

import { registerSynchCommands } from "./plugin/commands";
import { SynchPluginController } from "./plugin/plugin-controller";
import { SynchStatusBar } from "./plugin/status-bar";
import {
  SYNCH_VERSION_HISTORY_VIEW_TYPE,
  SynchVersionHistoryView,
} from "./plugin/version-history-view";
import { SynchSettingTab } from "./settings/settings-tab";

export default class SynchPlugin extends Plugin {
  private controller: SynchPluginController | null = null;
  private statusBar: SynchStatusBar | null = null;
  private settingsTab: SynchSettingTab | null = null;

  async onload(): Promise<void> {
    const controller = new SynchPluginController({
      plugin: this,
      refreshUi: () => {
        this.refreshUi();
      },
    });
    this.controller = controller;

    await controller.initialize();

    this.statusBar = new SynchStatusBar(this, controller);
    this.statusBar.initialize();

    this.registerView(
      SYNCH_VERSION_HISTORY_VIEW_TYPE,
      (leaf) => new SynchVersionHistoryView(leaf, controller),
    );
    this.settingsTab = new SynchSettingTab(this.app, this, controller);
    this.addSettingTab(this.settingsTab);
    registerSynchCommands(this, controller);
    this.registerConnectivityEvents(controller);

    this.refreshUi();

    this.app.workspace.onLayoutReady(() => {
      controller.registerVaultEvents();
      void controller.ensureAutoSyncState();
      void controller.ensureVersionHistoryPane();
    });
  }

  async onunload(): Promise<void> {
    await this.controller?.stop();
  }

  private registerConnectivityEvents(controller: SynchPluginController): void {
    const resume = () => {
      controller.queueAutoSyncResume();
    };

    this.registerDomEvent(window, "online", resume);
    this.registerDomEvent(window, "focus", resume);
    this.registerDomEvent(document, "visibilitychange", () => {
      if (document.visibilityState === "visible") {
        resume();
      }
    });
    this.registerEvent(
      this.app.workspace.on("file-open", () => {
        controller.refreshVersionHistoryViews();
      }),
    );
  }

  private refreshUi(): void {
    this.settingsTab?.refresh();
    this.statusBar?.refresh();
  }
}
