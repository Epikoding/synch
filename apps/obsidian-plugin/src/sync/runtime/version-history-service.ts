import { hashBytes } from "../core/content";
import { decryptSyncBlob, decryptSyncMetadata, encryptSyncMetadata } from "../core/crypto";
import type { SyncTokenResponse } from "../remote/client";
import type { SyncPullClient } from "../remote/pull-client";
import type {
  EntryVersion,
  EntryVersionPageCursor,
  SyncRealtimeSession,
} from "../remote/realtime-client";
import type {
  DeletedSyncEntryRow,
  SyncEntryRow,
} from "../store/store";
import type {
  SyncEntryStore,
  SyncMutationStore,
} from "../store/ports";

const VERSION_RESTORE_PAGE_SIZE = 25;
const VERSION_PREVIEW_UNAVAILABLE_MESSAGE = "This version has no previewable content.";

export interface SyncVersionHistoryServiceDeps {
  getApiBaseUrl: () => string;
  getSyncToken: () => Promise<SyncTokenResponse>;
  getStore: () => SyncVersionHistoryStore;
  getRemoteVaultKey: () => Uint8Array;
  pullClient: Pick<SyncPullClient, "downloadBlob">;
  withRealtimeSession: <T>(
    work: (session: SyncRealtimeSession) => Promise<T>,
  ) => Promise<T>;
  runLocalMutationWork: <T>(work: () => Promise<T>) => Promise<T>;
  pullOnce: (session: SyncRealtimeSession) => Promise<void>;
}

export interface SyncVersionHistoryStore
  extends Pick<
      SyncEntryStore,
      "getEntryById" | "getEntryByPath" | "listDeletedEntries"
    >,
    Pick<SyncMutationStore, "getDirtyEntryMutation"> {}

export class SyncVersionHistoryService {
  constructor(private readonly deps: SyncVersionHistoryServiceDeps) {}

  async listEntryVersionsForPath(
    path: string,
    before: EntryVersionPageCursor | null,
    limit: number,
  ): Promise<SyncEntryVersionsPage | null> {
    const store = this.deps.getStore();
    const entry = await store.getEntryByPath(path);
    if (!entry || entry.deleted || entry.revision <= 0) {
      return null;
    }

    return await this.deps.withRealtimeSession(async (session) => {
      const page = await session.listEntryVersions({
        entryId: entry.entryId,
        before,
        limit,
      });
      const dirty = await store.getDirtyEntryMutation(entry.entryId);
      return {
        path,
        dirty: dirty !== null,
        versions: page.versions,
        hasMore: page.hasMore,
        nextBefore: page.nextBefore,
      };
    });
  }

  async restoreEntryVersionForPath(
    path: string,
    version: EntryVersion,
  ): Promise<void> {
    await this.deps.runLocalMutationWork(async () => {
      const store = this.deps.getStore();
      const entry = await store.getEntryByPath(path);
      if (!entry || entry.deleted) {
        throw new Error("The active file is not synced.");
      }
      const dirty = await store.getDirtyEntryMutation(entry.entryId);
      if (dirty) {
        throw new Error("Sync local changes before restoring version history.");
      }

      await this.restoreEntryVersion(entry, version);
    });
  }

  async previewEntryVersionForPath(
    path: string,
    version: EntryVersion,
  ): Promise<SyncEntryVersionPreview> {
    const store = this.deps.getStore();
    const entry = await store.getEntryByPath(path);
    if (!entry || entry.deleted) {
      throw new Error("The active file is not synced.");
    }

    return await this.previewEntryVersion(entry.entryId, version, path);
  }

  async listDeletedEntries(): Promise<DeletedSyncEntryRow[]> {
    return await this.deps.getStore().listDeletedEntries();
  }

  async restoreDeletedEntry(entryId: string): Promise<void> {
    await this.deps.runLocalMutationWork(async () => {
      const store = this.deps.getStore();
      const entry = await store.getEntryById(entryId);
      if (!entry || !entry.deleted || entry.revision <= 0) {
        throw new Error("Deleted file is not synced.");
      }
      const dirty = await store.getDirtyEntryMutation(entry.entryId);
      if (dirty) {
        throw new Error("Sync local changes before restoring this deleted file.");
      }

      const version = await this.findLatestRestorableEntryVersion(entry.entryId);
      if (!version) {
        throw new Error("No restorable version exists for this deleted file.");
      }

      await this.restoreEntryVersion(entry, version);
    });
  }

  async previewDeletedEntry(entryId: string): Promise<SyncEntryVersionPreview> {
    const store = this.deps.getStore();
    const entry = await store.getEntryById(entryId);
    if (!entry || !entry.deleted || entry.revision <= 0) {
      throw new Error("Deleted file is not synced.");
    }

    const version = await this.findLatestRestorableEntryVersion(entry.entryId);
    const path = entry.path ?? entry.entryId;
    if (!version) {
      return {
        status: "unavailable",
        path,
        reason: null,
        capturedAt: null,
        message: VERSION_PREVIEW_UNAVAILABLE_MESSAGE,
      };
    }

    return await this.previewEntryVersion(entry.entryId, version, path);
  }

  private async findLatestRestorableEntryVersion(
    entryId: string,
  ): Promise<EntryVersion | null> {
    let before: EntryVersionPageCursor | null = null;

    return await this.deps.withRealtimeSession(async (session) => {
      do {
        const page = await session.listEntryVersions({
          entryId,
          before,
          limit: VERSION_RESTORE_PAGE_SIZE,
        });
        const version = page.versions.find(
          (candidate) => candidate.op === "upsert" && candidate.blobId,
        );
        if (version) {
          return version;
        }
        before = page.nextBefore;
      } while (before);

      return null;
    });
  }

  private async restoreEntryVersion(
    entry: SyncEntryRow,
    version: EntryVersion,
  ): Promise<void> {
    const metadata = await decryptSyncMetadata(
      this.deps.getRemoteVaultKey(),
      version.encryptedMetadata,
      {
        entryId: entry.entryId,
        revision: version.sourceRevision,
        op: version.op,
        blobId: version.blobId,
      },
    );
    const encryptedMetadata = await encryptSyncMetadata(
      this.deps.getRemoteVaultKey(),
      metadata,
      {
        entryId: entry.entryId,
        revision: entry.revision + 1,
        op: version.op,
        blobId: version.blobId,
      },
    );

    await this.deps.withRealtimeSession(async (session) => {
      await session.restoreEntryVersion({
        entryId: entry.entryId,
        versionId: version.versionId,
        baseRevision: entry.revision,
        op: version.op,
        blobId: version.blobId,
        encryptedMetadata,
      });
      await this.deps.pullOnce(session);
    });
  }

  private async previewEntryVersion(
    entryId: string,
    version: EntryVersion,
    fallbackPath: string,
  ): Promise<SyncEntryVersionPreview> {
    if (version.op !== "upsert" || !version.blobId) {
      return {
        status: "unavailable",
        path: fallbackPath,
        reason: version.reason,
        capturedAt: version.capturedAt,
        message: VERSION_PREVIEW_UNAVAILABLE_MESSAGE,
      };
    }

    const metadata = await decryptSyncMetadata(
      this.deps.getRemoteVaultKey(),
      version.encryptedMetadata,
      {
        entryId,
        revision: version.sourceRevision,
        op: version.op,
        blobId: version.blobId,
      },
    );
    const token = await this.deps.getSyncToken();
    const encryptedBytes = await this.deps.pullClient.downloadBlob(
      this.deps.getApiBaseUrl(),
      token.token,
      token.vaultId,
      version.blobId,
    );
    const bytes = await decryptSyncBlob(this.deps.getRemoteVaultKey(), encryptedBytes, {
      blobId: version.blobId,
    });
    const actualHash = await hashBytes(bytes);
    if (metadata.hash !== actualHash) {
      throw new Error("Version preview hash does not match metadata.");
    }

    const imageMimeType = detectPreviewImageMimeType(bytes);
    if (imageMimeType) {
      return {
        status: "image",
        path: metadata.path,
        reason: version.reason,
        capturedAt: version.capturedAt,
        mimeType: imageMimeType,
        bytes,
      };
    }

    const text = decodeUtf8Text(bytes);
    if (text === null) {
      return {
        status: "unavailable",
        path: metadata.path,
        reason: version.reason,
        capturedAt: version.capturedAt,
        message: "This version is not a UTF-8 text file.",
      };
    }

    return {
      status: "text",
      path: metadata.path,
      reason: version.reason,
      capturedAt: version.capturedAt,
      text,
    };
  }
}

export interface SyncEntryVersionsPage {
  path: string;
  dirty: boolean;
  versions: EntryVersion[];
  hasMore: boolean;
  nextBefore: EntryVersionPageCursor | null;
}

export type SyncEntryVersionPreview =
  | {
      status: "text";
      path: string;
      reason: EntryVersion["reason"];
      capturedAt: number;
      text: string;
    }
  | {
      status: "image";
      path: string;
      reason: EntryVersion["reason"];
      capturedAt: number;
      mimeType: string;
      bytes: Uint8Array;
    }
  | {
      status: "unavailable";
      path: string;
      reason: EntryVersion["reason"] | null;
      capturedAt: number | null;
      message: string;
    };

function decodeUtf8Text(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function detectPreviewImageMimeType(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70 &&
    bytes[8] === 0x61 &&
    bytes[9] === 0x76 &&
    bytes[10] === 0x69 &&
    bytes[11] === 0x66
  ) {
    return "image/avif";
  }

  return null;
}
