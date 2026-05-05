import { App, Notice, setIcon, setTooltip, Setting } from "obsidian";

import { getDefaultApiBaseUrl } from "../../config";
import type { SynchFileRules } from "../../plugin/view-models";
import { isStorageWarningStatus } from "../../utils/storage-warning";
import type { SynchSettingsController } from "../controller";
import {
  formatStorageDescription,
  formatSyncDescription,
  getStoragePercent,
  shouldShowSyncSpinner,
} from "./format";
import { DeletedFilesModal, ExcludedFoldersModal } from "./modals";

type RefreshSettings = () => void;

export interface SyncStatusSettingControls {
  refreshSyncStatus(): void;
  refreshStorageStatus(): void;
  refreshFileSizeBlockedWarning(): void;
}

interface FileSizeBlockedWarningControls {
  refreshFileSizeBlockedWarning(): void;
}

interface ProgressBarControl {
  setValue(value: number): ProgressBarControl;
}

export function renderSettingsHeading(
  containerEl: HTMLElement,
  controller: SynchSettingsController,
): void {
  const updateStatus = controller.getPluginUpdateStatus();
  const heading = new Setting(containerEl).setName("Synch").setHeading();
  if (updateStatus.state === "update_required") {
    heading.settingEl.addClass("synch-plugin-update-available");
    heading.controlEl.createSpan({
      cls: "synch-plugin-update-badge",
      text: "Update required",
    });
    return;
  }

  if (updateStatus.state !== "update_available") {
    return;
  }

  heading.settingEl.addClass("synch-plugin-update-available");
  heading.controlEl.createSpan({
    cls: "synch-plugin-update-badge",
    text: "Latest version available",
  });
}

export function renderApiBaseUrlSetting(
  containerEl: HTMLElement,
  controller: SynchSettingsController,
  options: {
    canChangeApiBaseUrl: boolean;
    hasConnectedRemoteVault: boolean;
    isDeviceLoginInProgress: boolean;
  },
): void {
  const apiBaseUrl = controller.getApiBaseUrl();
  const visibleApiBaseUrl = apiBaseUrl === getDefaultApiBaseUrl() ? "" : apiBaseUrl;
  let apiBaseUrlInput = visibleApiBaseUrl;
  new Setting(containerEl)
    .setName("Server URL")
    .setDesc(
      options.isDeviceLoginInProgress
        ? "Finish or cancel sign-in before changing servers."
        : options.hasConnectedRemoteVault
          ? "Disconnect the current vault before changing servers."
          : "Synch Cloud is used by default. Change this only for a self-hosted server.",
    )
    .addText((text) =>
      text
        .setPlaceholder("Synch Cloud")
        .setValue(visibleApiBaseUrl)
        .setDisabled(!options.canChangeApiBaseUrl)
        .onChange((value) => {
          apiBaseUrlInput = value;
        }),
    )
    .addButton((button) =>
      button
        .setButtonText("Save")
        .setDisabled(!options.canChangeApiBaseUrl)
        .onClick(async () => {
          try {
            await controller.updateApiBaseUrl(apiBaseUrlInput);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            new Notice(message);
          }
        }),
    );
}

export function renderSyncStatusSetting(
  containerEl: HTMLElement,
  controller: SynchSettingsController,
  hasConnectedRemoteVault: boolean,
): SyncStatusSettingControls | null {
  const updateStatus = controller.getPluginUpdateStatus();
  if (updateStatus.state === "update_required") {
    new Setting(containerEl)
      .setName("Sync paused")
      .setDesc(updateStatus.message);
    return null;
  }

  if (!hasConnectedRemoteVault) {
    new Setting(containerEl)
      .setName("Sync")
      .setDesc("Connect a remote vault to start syncing.");
    return null;
  }

  const storageStatus = controller.getStorageStatus();
  const getSyncDescription = (): string =>
    formatSyncDescription(
      controller.getSyncStatusLabel(),
      controller.getSyncProgress(),
    );
  const initialSyncDescription = getSyncDescription();
  const syncSetting = new Setting(containerEl)
    .setName("Sync")
    .setDesc(initialSyncDescription);
  syncSetting.descEl.empty();
  const syncDescriptionEl = syncSetting.descEl.createSpan({
    text: initialSyncDescription,
  });
  const refreshSyncDescription = (): void => {
    syncDescriptionEl.setText(getSyncDescription());
  };
  const fileSizeWarning = createFileSizeBlockedWarningControls(syncSetting, controller);
  fileSizeWarning.refreshFileSizeBlockedWarning();
  let spinnerEl: HTMLElement | null = null;
  const refreshSyncSpinner = (): void => {
    const shouldShow = shouldShowSyncSpinner(controller.getSyncState());
    if (shouldShow && !spinnerEl) {
      spinnerEl = syncSetting.nameEl.createSpan({
        cls: "synch-sync-spinner",
      });
      spinnerEl.setAttribute("aria-hidden", "true");
      setIcon(spinnerEl, "loader-circle");
      return;
    }

    if (!shouldShow && spinnerEl) {
      spinnerEl.remove();
      spinnerEl = null;
    }
  };
  refreshSyncSpinner();
  syncSetting.addButton((button) =>
    button
      .setButtonText(controller.isSyncEnabled() ? "Stop sync" : "Start sync")
      .onClick(async () => {
        await controller.setSyncEnabled(!controller.isSyncEnabled());
      }),
  );

  let storageProgressBar: ProgressBarControl | null = null;
  const storageSetting = new Setting(containerEl)
    .setName("Storage")
    .setDesc(storageStatus ? formatStorageDescription(storageStatus) : "Checking storage usage...")
    .addProgressBar((progressBar) => {
      storageProgressBar = progressBar;
      progressBar.setValue(storageStatus ? getStoragePercent(storageStatus) : 0);
    });
  if (isStorageWarningStatus(storageStatus)) {
    storageSetting.settingEl.addClass("synch-storage-warning");
  }

  return {
    refreshSyncStatus(): void {
      refreshSyncDescription();
      refreshSyncSpinner();
    },
    refreshStorageStatus(): void {
      const nextStorageStatus = controller.getStorageStatus();
      storageSetting.setDesc(
        nextStorageStatus
          ? formatStorageDescription(nextStorageStatus)
          : "Checking storage usage...",
      );
      storageProgressBar?.setValue(
        nextStorageStatus ? getStoragePercent(nextStorageStatus) : 0,
      );
      storageSetting.settingEl.toggleClass(
        "synch-storage-warning",
        isStorageWarningStatus(nextStorageStatus),
      );
    },
    refreshFileSizeBlockedWarning: fileSizeWarning.refreshFileSizeBlockedWarning,
  };
}

function createFileSizeBlockedWarningControls(
  syncSetting: Setting,
  controller: SynchSettingsController,
): FileSizeBlockedWarningControls {
  let run = 0;
  let icon: HTMLElement | null = null;

  async function refresh(currentRun: number): Promise<void> {
    let blockedFileCount = 0;
    try {
      blockedFileCount = (await controller.listFileSizeBlockedFiles()).length;
    } catch {
      return;
    }
    if (currentRun !== run) {
      return;
    }

    icon?.remove();
    icon = null;
    if (blockedFileCount <= 0) {
      return;
    }

    icon = syncSetting.descEl.createSpan({
      cls: "synch-sync-file-size-warning-icon",
    });
    icon.setAttribute("aria-hidden", "true");
    setIcon(icon, "triangle-alert");
    setTooltip(icon, formatFileSizeBlockedTooltip(blockedFileCount), {
      delay: 1,
      placement: "right",
    });
  }

  return {
    refreshFileSizeBlockedWarning(): void {
      run += 1;
      void refresh(run);
    },
  };
}

function formatFileSizeBlockedTooltip(blockedFileCount: number): string {
  return `${blockedFileCount} ${blockedFileCount === 1 ? "file exceeds" : "files exceed"} the sync size limit.`;
}

export function renderNetworkConnectionRequiredSetting(
  containerEl: HTMLElement,
): void {
  new Setting(containerEl)
    .setName("Network connection required")
    .setDesc("Connect to the internet to check sign-in.");
}

export function renderAuthenticationSetting(
  containerEl: HTMLElement,
  controller: SynchSettingsController,
  isDeviceLoginInProgress: boolean,
  refresh: RefreshSettings,
): void {
  const authSetting = new Setting(containerEl)
    .setName("Authentication")
    .setDesc(controller.getAuthStatusLabel());

  if (!controller.hasAuthenticatedSession()) {
    authSetting.addButton((button) =>
      button
        .setButtonText(
          isDeviceLoginInProgress
            ? "Open sign-in page again"
            : "Sign in on this device",
        )
        .onClick(async () => {
          await controller.beginDeviceLogin();
          refresh();
        }),
    );
  } else {
    authSetting.addButton((button) =>
      button
        .setButtonText("Sign out")
        .onClick(async () => {
          await controller.signOutDevice();
          refresh();
        }),
    );
  }
}

export function renderRemoteVaultSettings(
  app: App,
  containerEl: HTMLElement,
  controller: SynchSettingsController,
  hasConnectedRemoteVault: boolean,
  refresh: RefreshSettings,
): void {
  new Setting(containerEl)
    .setName("Vault management")
    .setDesc("Manage remote vaults for your account.")
    .addButton((button) =>
      button.setButtonText("Manage remote vaults").onClick(() => {
        controller.openRemoteVaultManagementPage();
      }),
    );

  const vaultSetting = new Setting(containerEl)
    .setName("Vault")
    .setDesc(controller.getRemoteVaultStatusLabel());

  if (hasConnectedRemoteVault) {
    vaultSetting.addButton((button) =>
      button.setButtonText("Disconnect vault").onClick(async () => {
        await controller.disconnectRemoteVault();
        refresh();
      }),
    );

    new Setting(containerEl)
      .setName("Deleted files")
      .setDesc("Review synced files that were deleted from this vault.")
      .addButton((button) =>
        button.setButtonText("View deleted files").onClick(() => {
          new DeletedFilesModal(app, {
            listDeletedFiles: async (before, limit) =>
              await controller.listDeletedFiles(before, limit),
            previewDeletedFile: async (entryId, fallbackPath) =>
              await controller.previewDeletedFile(entryId, fallbackPath),
            restoreDeletedFiles: async (files) => {
              const result = await controller.restoreDeletedFiles(files);
              refresh();
              return result;
            },
          }).open();
        }),
      );
    return;
  }

  vaultSetting
    .addButton((button) =>
      button.setButtonText("Create vault").onClick(async () => {
        await controller.createRemoteVaultFromPrompt();
        refresh();
      }),
    )
    .addButton((button) =>
      button.setButtonText("Connect vault").onClick(async () => {
        await controller.connectRemoteVaultFromPrompt();
        refresh();
      }),
    );
}

export function renderFileSyncSettings(
  app: App,
  containerEl: HTMLElement,
  controller: SynchSettingsController,
  refresh: RefreshSettings,
): void {
  const fileRules = controller.getSyncFileRules();

  new Setting(containerEl).setName("File sync").setHeading();

  addFileRuleToggle(
    containerEl,
    "Images",
    "Sync image attachments on this device.",
    fileRules,
    "includeImages",
    controller,
    refresh,
  );
  addFileRuleToggle(
    containerEl,
    "Audio",
    "Sync audio attachments on this device.",
    fileRules,
    "includeAudio",
    controller,
    refresh,
  );
  addFileRuleToggle(
    containerEl,
    "Videos",
    "Sync video attachments on this device.",
    fileRules,
    "includeVideos",
    controller,
    refresh,
  );
  addFileRuleToggle(
    containerEl,
    "PDF",
    "Sync PDF attachments on this device.",
    fileRules,
    "includePdf",
    controller,
    refresh,
  );
  addFileRuleToggle(
    containerEl,
    "Other file types",
    "Sync additional non-markdown file types on this device.",
    fileRules,
    "includeOtherFiles",
    controller,
    refresh,
  );

  new Setting(containerEl)
    .setName("Excluded folders")
    .setDesc(
      fileRules.excludedFolders.length > 0
        ? `${fileRules.excludedFolders.length} folder${fileRules.excludedFolders.length === 1 ? "" : "s"} excluded on this device.`
        : "No excluded folders on this device.",
    )
    .addButton((button) =>
      button.setButtonText("Manage").onClick(() => {
        new ExcludedFoldersModal(app, {
          availableFolders: controller.listSelectableExcludedFolderPaths(),
          initialSelection: fileRules.excludedFolders,
          onSubmit: async (paths) => {
            await controller.updateExcludedFolders(paths);
            refresh();
          },
        }).open();
      }),
    );

  for (const folder of fileRules.excludedFolders) {
    new Setting(containerEl)
      .setName(folder)
      .setDesc("Excluded from sync on this device.")
      .addButton((button) =>
        button.setButtonText("Remove").onClick(async () => {
          await controller.updateExcludedFolders(
            fileRules.excludedFolders.filter((value) => value !== folder),
          );
          refresh();
        }),
      );
  }

  containerEl.createEl("p", {
    cls: "synch-setting-hint",
    text:
      "File sync rules apply only to this device. Files already uploaded to the server are not removed automatically when you exclude them here.",
  });
}

function addFileRuleToggle<K extends keyof SynchFileRules>(
  containerEl: HTMLElement,
  name: string,
  description: string,
  fileRules: SynchFileRules,
  key: K,
  controller: SynchSettingsController,
  refresh: RefreshSettings,
): void {
  new Setting(containerEl)
    .setName(name)
    .setDesc(description)
    .addToggle((toggle) =>
      toggle.setValue(fileRules[key] as boolean).onChange(async (value) => {
        await controller.updateSyncFileRule(key, value as SynchFileRules[K]);
        refresh();
      }),
    );
}
