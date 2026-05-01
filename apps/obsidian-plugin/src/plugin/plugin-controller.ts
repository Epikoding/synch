import { Notice, type Plugin, TFolder } from "obsidian";

import { AuthManager } from "../auth/manager";
import { SynchPluginDataStore } from "../plugin-data";
import type { SynchSettingsController } from "../settings/controller";
import { SynchSettingsStore } from "../settings/store";
import { SynchRemoteVaultController } from "./remote-vault-controller";
import { SynchVersionHistoryController } from "./version-history-controller";
import type { VersionHistoryViewState } from "./version-history-view";
import type {
  SynchDeletedFile,
  SynchEntryVersionCursor,
  SynchFileRules,
  SynchPluginUpdateStatus,
  SynchStorageStatus,
  SynchSyncProgress,
  SynchSyncState,
} from "./view-models";
import { SynchPluginUpdateChecker } from "./update-checker";
import { normalizeExcludedFolders, type SyncFileRules } from "../sync/core/file-rules";
import type { SyncTokenResponse } from "../sync/remote/client";
import { SyncController } from "../sync/runtime/controller";
import { SyncTokenManager } from "../sync/remote/token-manager";
import type { StoredRemoteVaultKeySecret } from "../remote-vault/device-storage";
import {
  clearStoredRemoteVaultKeySecret,
  readStoredRemoteVaultKeySecret,
  writeStoredRemoteVaultKeySecret,
} from "../remote-vault/device-storage";
import { RemoteVaultManager } from "../remote-vault/manager";
import type { SyncConnection } from "../sync/store/store";

export interface SynchPluginControllerDeps {
  plugin: Plugin;
  refreshUi: () => void;
}

export class SynchPluginController implements SynchSettingsController {
  private readonly plugin = this.deps.plugin;
  private readonly pluginDataStore = new SynchPluginDataStore(this.plugin);
  private readonly settingsStore = new SynchSettingsStore(this.pluginDataStore);
  private readonly pluginUpdateChecker = new SynchPluginUpdateChecker();
  private pluginUpdateCheckPromise: Promise<void> | null = null;
  private pluginUpdateStatus: SynchPluginUpdateStatus = {
    state: "idle",
    currentVersion: this.plugin.manifest.version,
  };
  private storedRemoteVaultKeySecret: StoredRemoteVaultKeySecret | null = null;
  private storedSyncConnection: SyncConnection | null = null;
  private resumeAutoSyncPromise: Promise<void> | null = null;
  private readonly authManager = new AuthManager({
    plugin: this.plugin,
    getApiBaseUrl: () => this.getApiBaseUrl(),
    refreshUi: () => {
      this.refreshUi();
    },
  });
  private readonly remoteVaultManager = new RemoteVaultManager({
    getApiBaseUrl: () => this.getApiBaseUrl(),
    getAuthSessionToken: () => this.authManager.getAuthSessionToken(),
    hasAuthenticatedSession: () => this.authManager.hasAuthenticatedSession(),
    getStoredRemoteVaultId: () => this.storedSyncConnection?.remoteVaultId ?? null,
    getStoredRemoteVaultKeySecret: () => this.storedRemoteVaultKeySecret,
    saveStoredRemoteVaultKeySecret: async (vault) => {
      await this.saveStoredRemoteVaultKeySecret(vault);
    },
    refreshUi: () => {
      this.refreshUi();
    },
    notify: (message) => {
      new Notice(message);
    },
  });
  private readonly syncTokenManager = new SyncTokenManager({
    getApiBaseUrl: () => this.getApiBaseUrl(),
    getAuthSessionToken: () => this.authManager.getAuthSessionToken(),
    getRemoteVaultId: () => this.remoteVaultManager.getRemoteVaultId(),
    getLocalVaultId: async () => await this.syncController.readLocalVaultId(),
  });
  private readonly syncController = new SyncController({
    plugin: this.plugin,
    getApiBaseUrl: () => this.getApiBaseUrl(),
    getSyncToken: async () => await this.getSyncTokenForActiveRemoteVault(),
    invalidateSyncToken: () => {
      this.syncTokenManager.clear();
    },
    getRemoteVaultKey: () => this.getActiveRemoteVaultKey(),
    getSyncFileRules: () => this.getSyncFileRules(),
    hasActiveRemoteVaultSession: () => this.hasActiveRemoteVaultSession(),
    hasAuthenticatedSession: () => this.hasAuthenticatedSession(),
    notifyError: (error, prefix) => {
      this.notifyError(error, prefix);
    },
    notify: (message, timeout) => {
      new Notice(message, timeout);
    },
    onStatusChange: () => {
      this.refreshUi();
    },
  });
  private readonly versionHistoryController = new SynchVersionHistoryController({
    plugin: this.plugin,
    syncController: this.syncController,
    getSyncFileRules: () => this.getSyncFileRules(),
    hasAuthenticatedSession: () => this.hasAuthenticatedSession(),
    hasConnectedRemoteVault: () => this.hasConnectedRemoteVault(),
    refreshUi: () => this.refreshUi(),
  });
  private readonly remoteVaultController = new SynchRemoteVaultController({
    plugin: this.plugin,
    remoteVaultManager: this.remoteVaultManager,
    syncController: this.syncController,
    syncTokenManager: this.syncTokenManager,
    getApiBaseUrl: () => this.getApiBaseUrl(),
    getSyncFileRules: () => this.getSyncFileRules(),
    getStoredRemoteVaultId: () => this.storedSyncConnection?.remoteVaultId ?? null,
    hasConnectedRemoteVault: () => this.hasConnectedRemoteVault(),
    initializeSyncStoreForActiveRemoteVault: async () => {
      await this.initializeSyncStoreForActiveRemoteVault();
    },
    resetSyncConnection: async () => {
      await this.resetSyncConnection();
    },
    notifyError: (error, prefix) => {
      this.notifyError(error, prefix);
    },
  });

  constructor(private readonly deps: SynchPluginControllerDeps) {}

  async initialize(): Promise<void> {
    await this.pluginDataStore.initialize();
    await this.initializeSettings();
    this.storedRemoteVaultKeySecret = await readStoredRemoteVaultKeySecret(this.plugin);
    this.storedSyncConnection = await this.syncController.readStoredConnection();
    await this.authManager.initialize();
    await this.tryRestorePersistedRemoteVaultSession();
  }

  async stop(): Promise<void> {
    await this.syncController.stop();
  }

  registerVaultEvents(): void {
    this.syncController.registerVaultEvents();
  }

  ensureAutoSyncState(): Promise<void> {
    return this.syncController.ensureAutoSyncState();
  }

  queueAutoSyncResume(): void {
    if (this.resumeAutoSyncPromise) {
      return;
    }

    this.resumeAutoSyncPromise = this.syncController
      .resumeAutoSync()
      .catch((error) => {
        this.notifyError(error, "Auto sync resume failed");
      })
      .finally(() => {
        this.resumeAutoSyncPromise = null;
      });
  }

  getPluginUpdateStatus(): SynchPluginUpdateStatus {
    return this.pluginUpdateStatus;
  }

  async ensurePluginUpdateCheck(): Promise<void> {
    if (this.pluginUpdateStatus.state !== "idle") {
      await this.pluginUpdateCheckPromise;
      return;
    }

    await this.checkPluginUpdate();
  }

  async retryPluginUpdateCheck(): Promise<void> {
    await this.checkPluginUpdate();
  }

  getAuthStatusLabel(): string {
    return this.authManager.getAuthStatusLabel();
  }

  hasAuthenticatedSession(): boolean {
    return this.authManager.hasAuthenticatedSession();
  }

  isDeviceLoginInProgress(): boolean {
    return this.authManager.isDeviceLoginInProgress();
  }

  getRemoteVaultStatusLabel(): string {
    return this.remoteVaultManager.getRemoteVaultStatusLabel();
  }

  hasConnectedRemoteVault(): boolean {
    return this.remoteVaultManager.hasConnectedRemoteVault();
  }

  getSyncStatusLabel(): string {
    return this.syncController.getSyncStatusLabel();
  }

  getSyncState(): SynchSyncState {
    return this.syncController.getSyncState();
  }

  getSyncPercent(): number {
    return this.syncController.getSyncPercent();
  }

  getSyncProgress(): SynchSyncProgress {
    return this.syncController.getSyncProgress();
  }

  getStorageStatus(): SynchStorageStatus | null {
    return this.syncController.getStorageStatus();
  }

  getApiBaseUrl(): string {
    return this.settingsStore.getSnapshot().apiBaseUrl;
  }

  watchStorageStatus(): void {
    this.syncController.watchStorageStatus();
  }

  unwatchStorageStatus(): void {
    this.syncController.unwatchStorageStatus();
  }

  getSyncFileRules(): SynchFileRules {
    return this.settingsStore.getSnapshot().fileRules;
  }

  listSelectableExcludedFolderPaths(): string[] {
    return this.plugin.app.vault
      .getAllLoadedFiles()
      .filter((file): file is TFolder => file instanceof TFolder)
      .map((folder) => folder.path)
      .filter((path) => path.length > 0)
      .filter((path) => !path.split("/").some((segment) => segment.startsWith(".")))
      .sort((left, right) => left.localeCompare(right));
  }

  async updateSyncFileRule<K extends keyof SynchFileRules>(
    key: K,
    value: SynchFileRules[K],
  ): Promise<void> {
    await this.updateSyncFileRules({
      ...this.getSyncFileRules(),
      [key]: value,
    });
  }

  async updateExcludedFolders(paths: string[]): Promise<void> {
    await this.updateSyncFileRules({
      ...this.getSyncFileRules(),
      excludedFolders: normalizeExcludedFolders(paths),
    });
  }

  async updateApiBaseUrl(value: string): Promise<void> {
    if (this.hasAuthenticatedSession()) {
      throw new Error("Sign out before changing the API server.");
    }
    if (this.isDeviceLoginInProgress()) {
      throw new Error("Finish or cancel sign-in before changing the API server.");
    }
    if (this.hasConnectedRemoteVault()) {
      throw new Error("Disconnect the current vault before changing the API server.");
    }

    const changed = await this.settingsStore.updateApiBaseUrl(value);
    if (changed) {
      this.refreshUi();
    }
  }

  async getSyncTokenForActiveRemoteVault(): Promise<SyncTokenResponse> {
    return await this.syncTokenManager.getTokenForActiveRemoteVault();
  }

  async beginDeviceLogin(): Promise<void> {
    let loginStarted = false;

    try {
      loginStarted = await this.authManager.beginDeviceLogin();
      if (loginStarted) {
        await this.tryRestorePersistedRemoteVaultSession();
      }
    } finally {
      if (loginStarted) {
        this.syncTokenManager.clear();
        await this.syncController.ensureAutoSyncState();
      }
    }
  }

  async signOutDevice(): Promise<void> {
    try {
      await this.authManager.signOutDevice();
    } finally {
      this.syncTokenManager.clear();
      this.remoteVaultManager.clearSession();
      await this.saveStoredRemoteVaultKeySecret(null);
      await this.resetSyncConnection();
    }
  }

  async createRemoteVaultFromPrompt(): Promise<void> {
    await this.remoteVaultController.createRemoteVaultFromPrompt();
  }

  async connectRemoteVaultFromPrompt(): Promise<void> {
    await this.remoteVaultController.connectRemoteVaultFromPrompt();
  }

  openRemoteVaultManagementPage(): void {
    this.remoteVaultController.openRemoteVaultManagementPage();
  }

  async disconnectRemoteVault(): Promise<void> {
    await this.remoteVaultController.disconnectRemoteVault();
  }

  async openVersionHistoryPane(): Promise<void> {
    await this.versionHistoryController.openPane();
  }

  async listActiveFileVersions(
    before: SynchEntryVersionCursor | null,
    limit: number,
  ): Promise<VersionHistoryViewState> {
    return await this.versionHistoryController.listActiveFileVersions(before, limit);
  }

  async restoreActiveFileVersion(versionId: string): Promise<void> {
    await this.versionHistoryController.restoreActiveFileVersion(versionId);
  }

  async listDeletedFiles(): Promise<SynchDeletedFile[]> {
    return await this.versionHistoryController.listDeletedFiles();
  }

  async restoreDeletedFiles(entryIds: string[]): Promise<void> {
    await this.versionHistoryController.restoreDeletedFiles(entryIds);
  }

  refreshVersionHistoryViews(): void {
    this.versionHistoryController.refreshViews();
  }

  private refreshUi(): void {
    this.deps.refreshUi();
  }

  private async checkPluginUpdate(): Promise<void> {
    if (this.pluginUpdateCheckPromise) {
      await this.pluginUpdateCheckPromise;
      return;
    }

    this.pluginUpdateStatus = {
      state: "checking",
      currentVersion: this.plugin.manifest.version,
    };
    this.pluginUpdateCheckPromise = this.pluginUpdateChecker
      .check(this.plugin.manifest.version)
      .then((status) => {
        this.pluginUpdateStatus = status;
      })
      .catch((error) => {
        this.pluginUpdateStatus = {
          state: "failed",
          currentVersion: this.plugin.manifest.version,
          error: error instanceof Error ? error.message : String(error),
        };
      })
      .finally(() => {
        this.pluginUpdateCheckPromise = null;
        this.refreshUi();
      });

    await this.pluginUpdateCheckPromise;
  }

  private async saveStoredRemoteVaultKeySecret(
    vault: StoredRemoteVaultKeySecret | null,
  ): Promise<void> {
    this.storedRemoteVaultKeySecret = vault;
    if (vault) {
      await writeStoredRemoteVaultKeySecret(this.plugin, vault);
    } else {
      await clearStoredRemoteVaultKeySecret(this.plugin);
    }
    this.refreshUi();
  }

  private async tryRestorePersistedRemoteVaultSession(): Promise<void> {
    try {
      await this.remoteVaultManager.restorePersistedRemoteVaultSession();
      await this.initializeSyncStoreForActiveRemoteVault();
    } catch (error) {
      this.notifyError(error, "Vault restore failed");
    }
  }

  private async initializeSyncStoreForActiveRemoteVault(): Promise<void> {
    const remoteVaultId = this.remoteVaultManager.getRemoteVaultId();
    if (!remoteVaultId) {
      return;
    }

    await this.syncController.initializeStore(remoteVaultId);
    this.storedSyncConnection = await this.syncController.readStoredConnection();
  }

  private async resetSyncConnection(): Promise<void> {
    try {
      await this.syncController.resetLocalSyncState();
      this.storedSyncConnection = null;
    } catch (error) {
      this.notifyError(error, "Local sync state reset failed");
      this.syncController.stopAutoSyncAndMarkNotReady();
    }
  }

  private notifyError(error: unknown, prefix: string): void {
    const message = error instanceof Error ? error.message : String(error);
    new Notice(`${prefix}: ${message}`);
  }

  private getActiveRemoteVaultKey(): Uint8Array {
    const session = this.remoteVaultManager.getActiveSession();
    if (!session) {
      throw new Error("Vault session is not loaded.");
    }

    return session.remoteVaultKey;
  }

  private async initializeSettings(): Promise<void> {
    try {
      this.settingsStore.initialize();
    } catch (error) {
      this.notifyError(error, "Plugin settings initialization failed");
    }
  }

  private async updateSyncFileRules(nextRules: SyncFileRules): Promise<void> {
    const changed = await this.settingsStore.updateFileRules(nextRules);
    if (!changed) {
      return;
    }

    this.refreshUi();
    await this.syncController.reconcileAfterFileRuleChange();
  }

  private hasActiveRemoteVaultSession(): boolean {
    return this.remoteVaultManager.getActiveSession() !== null;
  }
}
