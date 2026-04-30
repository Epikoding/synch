export interface SynchFileRules {
  includeImages: boolean;
  includeAudio: boolean;
  includeVideos: boolean;
  includePdf: boolean;
  includeOtherFiles: boolean;
  excludedFolders: string[];
}

export type SynchSyncState =
  | "not_ready"
  | "syncing"
  | "reconnecting"
  | "up_to_date"
  | "attention_needed";

export interface SynchSyncProgress {
  completedEntries: number;
  totalEntries: number;
}

export interface SynchStorageStatus {
  storageUsedBytes: number;
  storageLimitBytes: number;
}

export interface SynchDeletedFile {
  entryId: string;
  path: string;
  revision: number;
  deletedAt: number;
  dirty: boolean;
}

export interface SynchEntryVersionCursor {
  capturedAt: number;
  versionId: string;
}

export interface SynchEntryVersion {
  versionId: string;
  sourceRevision: number;
  op: "upsert" | "delete";
  hasBlob: boolean;
  reason: "auto" | "before_delete" | "before_restore" | "manual";
  capturedAt: number;
}

export interface SynchEntryVersionsPage {
  path: string;
  dirty: boolean;
  versions: SynchEntryVersion[];
  hasMore: boolean;
  nextBefore: SynchEntryVersionCursor | null;
}
