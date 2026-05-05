import type { AuthReadiness } from "../auth/manager";
import type {
  SynchDeletedFileCursor,
  SynchDeletedFilesPage,
  SynchDeletedFile,
  SynchDeletedFilesRestoreResult,
  SynchFileSizeBlockedFile,
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
  getAuthReadiness(): AuthReadiness;
  getAuthStatusLabel(): string;
  getSyncState(): SynchSyncState;
  getSyncStatusLabel(): string;
  getSyncPercent(): number;
  getSyncProgress(): SynchSyncProgress;
  listFileSizeBlockedFiles(): Promise<SynchFileSizeBlockedFile[]>;
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
  listDeletedFiles(
    before: SynchDeletedFileCursor | null,
    limit: number,
  ): Promise<SynchDeletedFilesPage>;
  previewDeletedFile(entryId: string, fallbackPath: string): Promise<SynchVersionPreview>;
  restoreDeletedFiles(files: SynchDeletedFile[]): Promise<SynchDeletedFilesRestoreResult>;
}
