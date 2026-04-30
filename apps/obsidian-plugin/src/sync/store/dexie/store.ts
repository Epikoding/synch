import type { Plugin } from "obsidian";

import type {
  CachedSyncBlobRow,
  DeletedSyncEntryRow,
  LocalSyncEntryRow,
  MarkEntryDirtyOptions,
  PendingMutationBlockedReason,
  PendingMutationRow,
  RemoteSyncEntryRow,
  SyncConnection,
  SyncEntryRow,
  SyncEntryStateRow,
  SyncProgressCounts,
  SyncStore,
} from "../store";
import {
  METADATA_ID,
  MIN_PENDING_CREATED_AT,
  SyncDexieDatabase,
  syncStoreDbName,
} from "./database";
import {
  clearPendingMutation,
  copyRemoteToBase,
  createEmptyEntryRecord,
  hasPendingMutationRecord,
  isPresent,
  normalizeEntryRecord,
  normalizePendingMutation,
  sortEntryRows,
  toBlobRecord,
  toCachedBlobRow,
  toCombinedEntryRow,
  toDeletedEntryRow,
  toDirtyEntryRecord,
  toEntryStateRow,
  toLocalEntryRow,
  toPendingMutationRow,
  toRemoteEntryRow,
  toSyncConnection,
} from "./mappers";
import type { EntryRecord, MetadataRecord } from "./records";

export class DexieSyncStore implements SyncStore {
  private readonly db: SyncDexieDatabase;

  constructor(
    private readonly plugin: Plugin,
    private readonly localVaultId: string,
  ) {
    this.db = new SyncDexieDatabase(syncStoreDbName(localVaultId));
  }

  async initialize(): Promise<void> {
    await this.db.open();
  }

  async readLocalVaultId(): Promise<string> {
    return this.localVaultId;
  }

  async readSyncConnection(): Promise<SyncConnection | null> {
    const metadata = await this.readMetadata();
    return toSyncConnection(this.localVaultId, metadata);
  }

  async writeSyncConnection(connection: SyncConnection): Promise<void> {
    const localVaultId = connection.localVaultId.trim();
    const remoteVaultId = connection.remoteVaultId.trim();
    if (!localVaultId || !remoteVaultId) {
      throw new Error("Local and remote vault IDs are required.");
    }
    if (localVaultId !== this.localVaultId) {
      throw new Error("Local sync store belongs to a different local vault.");
    }

    await this.writeMetadata({
      remoteVaultId,
      lastPulledCursor: connection.lastPulledCursor,
    });
  }

  async ensureEntry(entryId: string): Promise<void> {
    await this.putEntry(await this.getOrCreateEntryRecord(entryId));
  }

  async getRemoteStateById(entryId: string): Promise<RemoteSyncEntryRow | null> {
    const row = await this.db.entries.get(entryId);
    return row?.remoteKnown ? toRemoteEntryRow(row) : null;
  }

  async getRemoteStateByPath(path: string): Promise<RemoteSyncEntryRow | null> {
    const row = await this.db.entries.where("remotePathKey").equals(path).first();
    return row?.remoteKnown ? toRemoteEntryRow(row) : null;
  }

  async listRemoteStates(): Promise<RemoteSyncEntryRow[]> {
    return sortEntryRows(
      (await this.db.entries.toArray())
        .filter((row) => row.remoteKnown)
        .map(toRemoteEntryRow),
    );
  }

  async applyRemoteState(entry: RemoteSyncEntryRow): Promise<void> {
    const existing = await this.getOrCreateEntryRecord(entry.entryId);
    const updated: EntryRecord = {
      ...existing,
      remoteKnown: true,
      remotePath: entry.path,
      remoteRevision: entry.revision,
      remoteBlobId: entry.blobId,
      remoteHash: entry.hash,
      remoteDeleted: entry.deleted,
      remoteUpdatedAt: entry.updatedAt,
    };

    if (!existing.dirty) {
      copyRemoteToBase(updated);
    }

    await this.putEntry(updated);
  }

  async clearRemoteState(entryId: string): Promise<void> {
    const existing = await this.db.entries.get(entryId);
    if (!existing) {
      return;
    }

    const updated: EntryRecord = {
      ...existing,
      remoteKnown: false,
      remotePath: null,
      remoteRevision: 0,
      remoteBlobId: null,
      remoteHash: null,
      remoteDeleted: true,
      remoteUpdatedAt: 0,
    };
    if (!updated.localKnown && !updated.dirty) {
      await this.db.entries.delete(entryId);
      return;
    }

    await this.putEntry(updated);
  }

  async getLocalStateById(entryId: string): Promise<LocalSyncEntryRow | null> {
    const row = await this.db.entries.get(entryId);
    return row?.localKnown ? toLocalEntryRow(row) : null;
  }

  async getLocalStateByPath(path: string): Promise<LocalSyncEntryRow | null> {
    const row = await this.db.entries.where("localPathKey").equals(path).first();
    return row?.localKnown ? toLocalEntryRow(row) : null;
  }

  async listLocalStates(): Promise<LocalSyncEntryRow[]> {
    return sortEntryRows(
      (await this.db.entries.toArray())
        .filter((row) => row.localKnown)
        .map(toLocalEntryRow),
    );
  }

  async applyLocalState(entry: LocalSyncEntryRow): Promise<void> {
    const existing = await this.getOrCreateEntryRecord(entry.entryId);
    await this.putEntry({
      ...existing,
      localKnown: true,
      localPath: entry.path,
      localBlobId: entry.blobId,
      localHash: entry.hash,
      localDeleted: entry.deleted,
      localUpdatedAt: entry.updatedAt,
      localMtime: entry.localMtime,
      localSize: entry.localSize,
    });
  }

  async clearLocalState(entryId: string): Promise<void> {
    const existing = await this.db.entries.get(entryId);
    if (!existing) {
      return;
    }

    const updated: EntryRecord = {
      ...existing,
      localKnown: false,
      localPath: null,
      localBlobId: null,
      localHash: null,
      localDeleted: true,
      localUpdatedAt: 0,
      localMtime: null,
      localSize: null,
    };
    if (!updated.remoteKnown && !updated.dirty) {
      await this.db.entries.delete(entryId);
      return;
    }

    await this.putEntry(updated);
  }

  async getEntryById(entryId: string): Promise<SyncEntryRow | null> {
    const row = await this.db.entries.get(entryId);
    return row ? toCombinedEntryRow(row) : null;
  }

  async getEntryByPath(path: string): Promise<SyncEntryRow | null> {
    const local = await this.db.entries.where("localPathKey").equals(path).first();
    if (local?.localKnown) {
      return toCombinedEntryRow(local);
    }

    const remote = await this.db.entries.where("remotePathKey").equals(path).first();
    if (!remote?.remoteKnown) {
      return null;
    }

    if (remote.localKnown && remote.localPath !== path) {
      return null;
    }
    return toCombinedEntryRow(remote);
  }

  async getEntryStateById(entryId: string): Promise<SyncEntryStateRow | null> {
    const row = await this.db.entries.get(entryId);
    return row ? toEntryStateRow(row) : null;
  }

  async listEntries(): Promise<SyncEntryRow[]> {
    return sortEntryRows(
      (await this.db.entries.toArray())
        .map(toCombinedEntryRow)
        .filter((entry): entry is SyncEntryRow => !!entry),
    );
  }

  async listDeletedEntries(): Promise<DeletedSyncEntryRow[]> {
    return (await this.db.entries.toArray())
      .filter((row) => row.remoteKnown && row.remoteDeleted && row.remoteRevision > 0)
      .map(toDeletedEntryRow)
      .filter(isPresent)
      .sort((left, right) => {
        if (left.deletedAt !== right.deletedAt) {
          return right.deletedAt - left.deletedAt;
        }
        return left.path.localeCompare(right.path);
      });
  }

  async countSyncProgress(): Promise<SyncProgressCounts> {
    const entries = await this.db.entries.toArray();
    let completedEntries = 0;
    let totalEntries = 0;

    for (const entry of entries) {
      const hasPendingMutation = hasPendingMutationRecord(entry);
      const deleted = entry.localKnown
        ? entry.localDeleted
        : entry.remoteKnown
          ? entry.remoteDeleted
          : true;
      if (!hasPendingMutation && deleted) {
        continue;
      }

      totalEntries += 1;
      if (entry.remoteKnown && entry.remoteRevision > 0 && !hasPendingMutation) {
        completedEntries += 1;
      }
    }

    return { completedEntries, totalEntries };
  }

  async getOrCreateEntryId(path: string): Promise<string> {
    const existing = await this.getEntryByPath(path);
    if (existing) {
      return existing.entryId;
    }

    return crypto.randomUUID();
  }

  async upsertEntry(entry: SyncEntryRow): Promise<void> {
    const row = normalizeEntryRecord({
      ...createEmptyEntryRecord(entry.entryId),
      remoteKnown: true,
      remotePath: entry.path,
      remoteRevision: entry.revision,
      remoteBlobId: entry.blobId,
      remoteHash: entry.hash,
      remoteDeleted: entry.deleted,
      remoteUpdatedAt: entry.updatedAt,
      basePath: entry.path,
      baseRevision: entry.revision,
      baseBlobId: entry.blobId,
      baseHash: entry.hash,
      baseDeleted: entry.deleted,
      localKnown: true,
      localPath: entry.path,
      localBlobId: entry.blobId,
      localHash: entry.hash,
      localDeleted: entry.deleted,
      localUpdatedAt: entry.updatedAt,
      localMtime: entry.localMtime,
      localSize: entry.localSize,
    });
    await this.db.entries.put(row);
  }

  async deleteEntry(entryId: string): Promise<void> {
    await this.db.entries.delete(entryId);
  }

  async getCursor(): Promise<number> {
    return (await this.readMetadata())?.lastPulledCursor ?? 0;
  }

  async setCursor(cursor: number): Promise<void> {
    const connection = await this.readSyncConnection();
    if (!connection) {
      throw new Error("Sync connection is not initialized.");
    }

    await this.writeMetadata({
      remoteVaultId: connection.remoteVaultId,
      lastPulledCursor: cursor,
    });
  }

  async markEntryDirty(
    mutation: PendingMutationRow,
    options: MarkEntryDirtyOptions = {},
  ): Promise<void> {
    const normalized = normalizePendingMutation(mutation);
    if (options.requireBaseBlob) {
      await this.assertRequiredBaseBlob(normalized);
    }
    const entry = await this.getOrCreateEntryRecord(normalized.entryId);
    await this.putEntry(toDirtyEntryRecord(entry, normalized));
  }

  async replaceDirtyEntry(
    mutation: PendingMutationRow,
    options: MarkEntryDirtyOptions = {},
  ): Promise<void> {
    const normalized = normalizePendingMutation(mutation);
    await this.db.transaction("rw", this.db.entries, this.db.blobs, async () => {
      if (options.requireBaseBlob) {
        await this.assertRequiredBaseBlob(normalized);
      }
      const entry = await this.getOrCreateEntryRecord(normalized.entryId);
      await this.putEntry(toDirtyEntryRecord(entry, normalized));
    });
  }

  async getDirtyEntryMutation(entryId: string): Promise<PendingMutationRow | null> {
    const row = await this.db.entries.get(entryId);
    return row ? toPendingMutationRow(row) : null;
  }

  async listDirtyEntries(limit?: number): Promise<PendingMutationRow[]> {
    let collection = this.db.entries
      .where("[pendingStatus+pendingCreatedAt+entryId]")
      .between(
        ["pending", MIN_PENDING_CREATED_AT, ""],
        ["pending", [], []],
      );
    if (limit !== undefined) {
      collection = collection.limit(limit);
    }

    const rows = await collection.toArray();
    return rows.map((row) => toPendingMutationRow(row)).filter(isPresent);
  }

  async updateDirtyEntry(mutation: PendingMutationRow): Promise<void> {
    await this.markEntryDirty(mutation);
  }

  async unblockDirtyEntriesByReason(
    reason: PendingMutationBlockedReason,
  ): Promise<void> {
    const blocked = await this.db.entries
      .where("pendingStatus")
      .equals("blocked")
      .filter((entry) => entry.pendingBlockedReason === reason)
      .toArray();
    await this.db.transaction("rw", this.db.entries, async () => {
      for (const entry of blocked) {
        await this.putEntry({
          ...entry,
          pendingStatus: "pending",
          pendingBlockedReason: null,
        });
      }
    });
  }

  async clearDirtyEntryByMutationId(mutationId: string): Promise<void> {
    const entry = await this.db.entries
      .where("pendingMutationId")
      .equals(mutationId)
      .first();
    if (!entry) {
      return;
    }

    await this.putEntry(clearPendingMutation(entry));
  }

  async markEntryClean(entryId: string): Promise<void> {
    const entry = await this.db.entries.get(entryId);
    if (!entry) {
      return;
    }

    await this.putEntry(clearPendingMutation(entry));
  }

  async getBlob(blobId: string): Promise<CachedSyncBlobRow | null> {
    const row = await this.db.blobs.get(blobId);
    return row ? toCachedBlobRow(row) : null;
  }

  async putBlob(blob: CachedSyncBlobRow): Promise<void> {
    await this.db.blobs.put(toBlobRecord(blob));
  }

  async flush(): Promise<void> {}

  async close(): Promise<void> {
    this.db.close();
  }

  private async getOrCreateEntryRecord(entryId: string): Promise<EntryRecord> {
    return (await this.db.entries.get(entryId)) ?? createEmptyEntryRecord(entryId);
  }

  private async putEntry(entry: EntryRecord): Promise<void> {
    await this.db.entries.put(normalizeEntryRecord(entry));
  }

  private async assertRequiredBaseBlob(
    mutation: Required<PendingMutationRow>,
  ): Promise<void> {
    if (!mutation.baseBlobId || !mutation.baseHash) {
      return;
    }

    const blob = await this.db.blobs.get(mutation.baseBlobId);
    if (!blob || blob.hash !== mutation.baseHash) {
      throw new Error(
        `Dirty entry ${mutation.entryId} requires cached base blob ${mutation.baseBlobId}.`,
      );
    }
  }

  private async readMetadata(): Promise<MetadataRecord | null> {
    return (await this.db.metadata.get(METADATA_ID)) ?? null;
  }

  private async writeMetadata(
    metadata: Omit<MetadataRecord, "id">,
  ): Promise<void> {
    await this.db.metadata.put({
      id: METADATA_ID,
      remoteVaultId: metadata.remoteVaultId,
      lastPulledCursor: metadata.lastPulledCursor,
    });
  }
}
