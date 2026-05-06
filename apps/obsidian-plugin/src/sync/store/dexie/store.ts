import type {
  AcceptedPushMutationRow,
  CachedSyncBlobRow,
  LocalSyncEntryRow,
  MarkEntryDirtyOptions,
  PendingMutationBlockedReason,
  PendingMutationRow,
  RemoteSyncEntryRow,
  SyncConnection,
  SyncEntryRow,
  SyncEntryStateRow,
  SyncProgressCounts,
  SyncReconcileEntryState,
  SyncReconcileEntryUpdate,
  SyncStore,
} from "../store";
import { decryptSyncMetadata, encryptSyncMetadata } from "../../core/crypto";
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
  toDirtyEntryRecord,
  toEntryStateRow,
  toLocalEntryRow,
  toPendingMutationRow,
  toRemoteEntryRow,
  toSyncConnection,
} from "./mappers";
import type { BlobRecord, EntryRecord, MetadataRecord } from "./records";

const ACCEPTED_PUSH_BATCH_MAX_RETRIES = 3;

export class DexieSyncStore implements SyncStore {
  private readonly db: SyncDexieDatabase;

  constructor(private readonly localVaultId: string) {
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

  async listBlockedDirtyEntriesByReason(
    reason: PendingMutationBlockedReason,
  ): Promise<PendingMutationRow[]> {
    const blocked = await this.db.entries
      .where("pendingStatus")
      .equals("blocked")
      .filter((entry) => entry.pendingBlockedReason === reason)
      .toArray();
    return blocked.map((row) => toPendingMutationRow(row)).filter(isPresent);
  }

  async unblockDirtyEntriesByReason(reason: PendingMutationBlockedReason): Promise<void> {
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
          pendingBlockedEncryptedSizeBytes: null,
          pendingBlockedMaxFileSizeBytes: null,
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

  async listReconcileEntryStates(): Promise<SyncReconcileEntryState[]> {
    return (await this.db.entries.toArray()).map((row) => ({
      entryId: row.entryId,
      remote: row.remoteKnown ? toRemoteEntryRow(row) : null,
      local: row.localKnown ? toLocalEntryRow(row) : null,
      dirty: toPendingMutationRow(row),
    }));
  }

  async applyReconcileEntryUpdates(
    updates: SyncReconcileEntryUpdate[],
  ): Promise<void> {
    if (updates.length === 0) {
      return;
    }

    await this.db.transaction("rw", this.db.entries, this.db.blobs, async () => {
      const existingRows = await this.db.entries.bulkGet(
        updates.map((update) => update.entryId),
      );
      const rowsToPut: EntryRecord[] = [];
      const entryIdsToDelete: string[] = [];

      for (let index = 0; index < updates.length; index += 1) {
        const update = updates[index];
        if (update.deleteEntry) {
          entryIdsToDelete.push(update.entryId);
          continue;
        }

        let row = existingRows[index] ?? createEmptyEntryRecord(update.entryId);
        if (update.dirty !== undefined) {
          if (update.dirty === null) {
            row = clearPendingMutation(row);
          } else {
            const mutation = normalizePendingMutation(update.dirty);
            if (update.requireBaseBlob) {
              await this.assertRequiredBaseBlob(mutation);
            }
            row = toDirtyEntryRecord(row, mutation);
          }
        } else if (update.clearDirty) {
          row = clearPendingMutation(row);
        }

        if (update.local) {
          row = {
            ...row,
            localKnown: true,
            localPath: update.local.path,
            localBlobId: update.local.blobId,
            localHash: update.local.hash,
            localDeleted: update.local.deleted,
            localUpdatedAt: update.local.updatedAt,
            localMtime: update.local.localMtime,
            localSize: update.local.localSize,
          };
        }

        rowsToPut.push(normalizeEntryRecord(row));
      }

      if (entryIdsToDelete.length > 0) {
        await this.db.entries.bulkDelete(entryIdsToDelete);
      }
      if (rowsToPut.length > 0) {
        await this.db.entries.bulkPut(rowsToPut);
      }
    });
  }

  async getBlob(blobId: string): Promise<CachedSyncBlobRow | null> {
    const row = await this.db.blobs.get(blobId);
    return row ? toCachedBlobRow(row) : null;
  }

  async putBlob(blob: CachedSyncBlobRow): Promise<void> {
    await this.db.blobs.put(toBlobRecord(blob));
  }

  async applyAcceptedPushBatch(
    accepted: AcceptedPushMutationRow[],
    options: { remoteVaultKey: Uint8Array },
  ): Promise<void> {
    if (accepted.length === 0) {
      return;
    }

    for (let attempt = 0; attempt < ACCEPTED_PUSH_BATCH_MAX_RETRIES; attempt += 1) {
      const initialRows = await this.db.entries.bulkGet(
        accepted.map((item) => item.mutation.entryId),
      );
      const plans = await Promise.all(
        accepted.map((item, index) =>
          planAcceptedPushApply(
            initialRows[index] ?? createEmptyEntryRecord(item.mutation.entryId),
            item,
            options.remoteVaultKey,
          ),
        ),
      );

      try {
        await this.db.transaction("rw", this.db.entries, this.db.blobs, async () => {
          const existingRows = await this.db.entries.bulkGet(
            accepted.map((item) => item.mutation.entryId),
          );
          const rowsToPut: EntryRecord[] = [];
          const blobsToPut: BlobRecord[] = [];

          for (let index = 0; index < accepted.length; index += 1) {
            const item = accepted[index];
            const row =
              existingRows[index] ?? createEmptyEntryRecord(item.mutation.entryId);
            const applied = applyAcceptedPushToEntry(row, item, plans[index]);
            if (applied === "retry") {
              throw new AcceptedPushBatchRetryError();
            }
            rowsToPut.push(applied);

            if (item.remoteCacheBlob) {
              blobsToPut.push(toBlobRecord(item.remoteCacheBlob));
            }
          }

          await this.db.entries.bulkPut(rowsToPut.map(normalizeEntryRecord));
          if (blobsToPut.length > 0) {
            await this.db.blobs.bulkPut(blobsToPut);
          }
        });
        return;
      } catch (error) {
        if (error instanceof AcceptedPushBatchRetryError) {
          continue;
        }
        throw error;
      }
    }

    throw new Error("Accepted push batch changed while applying; retry limit exceeded.");
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

class AcceptedPushBatchRetryError extends Error {
  constructor() {
    super("Accepted push batch changed while applying.");
    this.name = "AcceptedPushBatchRetryError";
  }
}

interface AcceptedPushApplyPlan {
  rebase:
    | {
        pendingMutationId: string;
        encryptedMetadata: string;
      }
    | null;
}

async function planAcceptedPushApply(
  row: EntryRecord,
  accepted: AcceptedPushMutationRow,
  remoteVaultKey: Uint8Array,
): Promise<AcceptedPushApplyPlan> {
  const currentPending = toPendingMutationRow(row);
  if (!currentPending || currentPending.mutationId === accepted.mutation.mutationId) {
    return { rebase: null };
  }

  const pendingMetadata = await decryptSyncMetadata(
    remoteVaultKey,
    currentPending.encryptedMetadata,
    metadataContextFromMutation(currentPending),
  );

  return {
    rebase: {
      pendingMutationId: currentPending.mutationId,
      encryptedMetadata: await encryptSyncMetadata(
        remoteVaultKey,
        pendingMetadata,
        metadataContextFromMutation({
          ...currentPending,
          baseRevision: accepted.acceptedRevision,
          baseBlobId: accepted.remoteBlobId,
          baseHash: accepted.localHash,
        }),
      ),
    },
  };
}

function applyAcceptedPushToEntry(
  row: EntryRecord,
  accepted: AcceptedPushMutationRow,
  plan: AcceptedPushApplyPlan,
): EntryRecord | "retry" {
  const { mutation, metadata } = accepted;
  let updated: EntryRecord = {
    ...row,
    remoteKnown: true,
    remotePath: metadata.path,
    remoteRevision: accepted.acceptedRevision,
    remoteBlobId: mutation.op === "delete" ? null : accepted.remoteBlobId,
    remoteHash: mutation.op === "delete" ? null : accepted.localHash,
    remoteDeleted: mutation.op === "delete",
    remoteUpdatedAt: accepted.acceptedAt,
  };

  if (mutation.op === "upsert" && shouldApplyAcceptedPushToLocal(updated, accepted)) {
    updated = {
      ...updated,
      localKnown: true,
      localPath: metadata.path,
      localBlobId: accepted.remoteBlobId,
      localHash: accepted.localHash,
      localDeleted: false,
      localUpdatedAt: accepted.acceptedAt,
      localMtime: updated.localMtime,
      localSize: updated.localSize,
    };
  }

  const currentPending = toPendingMutationRow(updated);
  if (!currentPending) {
    copyRemoteToBase(updated);
    return updated;
  }

  if (currentPending.mutationId === mutation.mutationId) {
    updated = clearPendingMutation(updated);
    copyRemoteToBase(updated);
    return updated;
  }

  if (plan.rebase?.pendingMutationId !== currentPending.mutationId) {
    return "retry";
  }

  return toDirtyEntryRecord(
    updated,
    normalizePendingMutation({
      ...currentPending,
      baseRevision: accepted.acceptedRevision,
      baseBlobId: accepted.remoteBlobId,
      baseHash: accepted.localHash,
      encryptedMetadata: plan.rebase.encryptedMetadata,
    }),
  );
}

function shouldApplyAcceptedPushToLocal(
  row: EntryRecord,
  accepted: AcceptedPushMutationRow,
): boolean {
  return (
    !row.localKnown ||
    (row.localHash === accepted.mutation.hash &&
      row.localPath === accepted.metadata.path)
  );
}

function metadataContextFromMutation(mutation: PendingMutationRow) {
  return {
    entryId: mutation.entryId,
    revision: mutation.baseRevision + 1,
    op: mutation.op,
    blobId: mutation.blobId,
  };
}
