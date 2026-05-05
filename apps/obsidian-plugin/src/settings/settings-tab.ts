import { App, Plugin, PluginSettingTab, Setting } from "obsidian";

import type { SynchSettingsController } from "./controller";
import {
  renderApiBaseUrlSetting,
  renderAuthenticationSetting,
  renderFileSyncSettings,
  renderNetworkConnectionRequiredSetting,
  renderRemoteVaultSettings,
  renderSettingsHeading,
  renderSyncStatusSetting,
  type SyncStatusSettingControls,
} from "./settings-tab/sections";

export class SynchSettingTab extends PluginSettingTab {
  private isVisible = false;
  private syncStatusControls: SyncStatusSettingControls | null = null;

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

  refreshFileSizeBlockedWarning(): void {
    this.syncStatusControls?.refreshFileSizeBlockedWarning();
  }

  hide(): void {
    this.isVisible = false;
    this.syncStatusControls = null;
    super.hide();
  }

  private render(): void {
    const { containerEl } = this;
    containerEl.empty();
    this.syncStatusControls = null;
    const hasConnectedRemoteVault = this.controller.hasConnectedRemoteVault();
    const hasAuthenticatedSession = this.controller.hasAuthenticatedSession();
    const authReadiness = this.controller.getAuthReadiness();
    const isDeviceLoginInProgress = this.controller.isDeviceLoginInProgress();
    const canChangeApiBaseUrl =
      !hasAuthenticatedSession &&
      !isDeviceLoginInProgress &&
      !hasConnectedRemoteVault;

    void this.controller.ensurePluginUpdateCheck();
    renderSettingsHeading(containerEl, this.controller);

    if (authReadiness.state === "pending_network") {
      renderNetworkConnectionRequiredSetting(containerEl);
      return;
    }

    if (hasAuthenticatedSession) {
      this.syncStatusControls = renderSyncStatusSetting(
        containerEl,
        this.controller,
        hasConnectedRemoteVault,
      );
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

}
