import { App, Plugin, PluginSettingTab, Setting } from "obsidian";

import type { SynchSettingsController } from "./controller";
import {
  renderApiBaseUrlSetting,
  renderAuthenticationSetting,
  renderFileSyncSettings,
  renderRemoteVaultSettings,
  renderSettingsHeading,
  renderSyncStatusSetting,
} from "./settings-tab/sections";

export class SynchSettingTab extends PluginSettingTab {
  private isVisible = false;
  private isWatchingStorageStatus = false;

  constructor(
    app: App,
    plugin: Plugin,
    private readonly controller: SynchSettingsController,
  ) {
    super(app, plugin);
  }

  display(): void {
    this.isVisible = true;
    this.render();
  }

  refresh(): void {
    if (!this.isVisible) {
      return;
    }

    this.render();
  }

  hide(): void {
    this.isVisible = false;
    this.setStorageStatusWatching(false);
    super.hide();
  }

  private render(): void {
    const { containerEl } = this;
    containerEl.empty();
    const hasConnectedRemoteVault = this.controller.hasConnectedRemoteVault();
    const hasAuthenticatedSession = this.controller.hasAuthenticatedSession();
    const isDeviceLoginInProgress = this.controller.isDeviceLoginInProgress();
    const canChangeApiBaseUrl =
      !hasAuthenticatedSession &&
      !isDeviceLoginInProgress &&
      !hasConnectedRemoteVault;
    this.setStorageStatusWatching(hasAuthenticatedSession && hasConnectedRemoteVault);

    void this.controller.ensurePluginUpdateCheck();
    renderSettingsHeading(containerEl, this.controller);

    if (hasAuthenticatedSession) {
      renderSyncStatusSetting(containerEl, this.controller, hasConnectedRemoteVault);
    } else {
      new Setting(containerEl).setName("Account").setHeading();
    }

    renderAuthenticationSetting(
      containerEl,
      this.controller,
      isDeviceLoginInProgress,
      () => this.refresh(),
    );

    if (!hasAuthenticatedSession) {
      new Setting(containerEl).setName("Self-hosted server").setHeading();
      renderApiBaseUrlSetting(containerEl, this.controller, {
        canChangeApiBaseUrl,
        hasConnectedRemoteVault,
        isDeviceLoginInProgress,
      });
      return;
    }

    renderRemoteVaultSettings(
      this.app,
      containerEl,
      this.controller,
      hasConnectedRemoteVault,
      () => this.refresh(),
    );
    renderFileSyncSettings(this.app, containerEl, this.controller, () => this.refresh());
  }

  private setStorageStatusWatching(enabled: boolean): void {
    if (this.isWatchingStorageStatus === enabled) {
      return;
    }

    this.isWatchingStorageStatus = enabled;
    if (enabled) {
      this.controller.watchStorageStatus();
    } else {
      this.controller.unwatchStorageStatus();
    }
  }

}
