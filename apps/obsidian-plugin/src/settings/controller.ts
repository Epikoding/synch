import type {
  SynchDeletedFile,
  SynchFileRules,
  SynchPluginUpdateStatus,
  SynchStorageStatus,
  SynchSyncProgress,
  SynchSyncState,
  SynchVersionPreview,
} from "../plugin/view-models";

export interface SynchSettingsController {
  getPluginUpdateStatus(): SynchPluginUpdateStatus;
  ensurePluginUpdateCheck(): Promise<void>;
  retryPluginUpdateCheck(): Promise<void>;
  getAuthStatusLabel(): string;
  getSyncState(): SynchSyncState;
  getSyncStatusLabel(): string;
  getSyncPercent(): number;
  getSyncProgress(): SynchSyncProgress;
  isSyncEnabled(): boolean;
  setSyncEnabled(enabled: boolean): Promise<void>;
  getStorageStatus(): SynchStorageStatus | null;
  watchStorageStatus(): void;
  unwatchStorageStatus(): void;
  getRemoteVaultStatusLabel(): string;
  getApiBaseUrl(): string;
  hasAuthenticatedSession(): boolean;
  isDeviceLoginInProgress(): boolean;
  hasConnectedRemoteVault(): boolean;
  beginDeviceLogin(): Promise<void>;
  signOutDevice(): Promise<void>;
  createRemoteVaultFromPrompt(): Promise<void>;
  connectRemoteVaultFromPrompt(): Promise<void>;
  openRemoteVaultManagementPage(): void;
  disconnectRemoteVault(): Promise<void>;
  updateApiBaseUrl(value: string): Promise<void>;
  getSyncFileRules(): SynchFileRules;
  updateSyncFileRule<K extends keyof SynchFileRules>(
    key: K,
    value: SynchFileRules[K],
  ): Promise<void>;
  updateExcludedFolders(paths: string[]): Promise<void>;
  listSelectableExcludedFolderPaths(): string[];
  listDeletedFiles(): Promise<SynchDeletedFile[]>;
  previewDeletedFile(entryId: string): Promise<SynchVersionPreview>;
  restoreDeletedFiles(entryIds: string[]): Promise<void>;
}
