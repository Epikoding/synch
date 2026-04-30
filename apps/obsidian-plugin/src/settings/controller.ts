import type {
  SynchDeletedFile,
  SynchFileRules,
  SynchStorageStatus,
  SynchSyncProgress,
  SynchSyncState,
} from "../plugin/view-models";

export interface SynchSettingsController {
  getAuthStatusLabel(): string;
  getSyncState(): SynchSyncState;
  getSyncStatusLabel(): string;
  getSyncPercent(): number;
  getSyncProgress(): SynchSyncProgress;
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
  restoreDeletedFiles(entryIds: string[]): Promise<void>;
}
