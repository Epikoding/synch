import { hashBytes } from "../core/content";
import { decryptSyncMetadata } from "../core/crypto";
import {
  queueLocalDeleteMutation,
  queueLocalUpsertMutation,
} from "../core/mutation-queue";
import type {
  LocalSyncEntryRow,
  RemoteSyncEntryRow,
} from "../store/store";
import type {
  SyncEntryStore,
  SyncLocalEntryStore,
  SyncMutationStore,
  SyncRemoteEntryStore,
  SyncStoreLifecycle,
} from "../store/ports";
import { isAutoMergeTextPath } from "./text-merge-policy";

const DEFAULT_RECONCILE_HASH_CONCURRENCY = 8;

export interface LocalSyncFile {
  path: string;
  mtime: number;
  size: number;
  readBytes(): Promise<Uint8Array>;
}

export interface LocalFileScanner {
  listFiles(): Promise<LocalSyncFile[]>;
}

export interface SyncLocalReconcileServiceDeps {
  getSyncStore: () => SyncLocalReconcileStore | null;
  getRemoteVaultKey: () => Uint8Array;
  scanner: LocalFileScanner;
  shouldSyncPath(path: string): boolean;
  hashConcurrency?: number;
}

export interface SyncLocalReconcileStore
  extends Pick<SyncEntryStore, "deleteEntry" | "getEntryByPath" | "getOrCreateEntryId">,
    Pick<
      SyncLocalEntryStore,
      "applyLocalState" | "getLocalStateByPath" | "listLocalStates"
    >,
    Pick<SyncRemoteEntryStore, "getRemoteStateById">,
    Pick<
      SyncMutationStore,
      "getDirtyEntryMutation" | "markEntryClean" | "replaceDirtyEntry"
    >,
    Pick<SyncStoreLifecycle, "flush"> {}

export interface ReconcileOnceResult {
  filesScanned: number;
  filesQueuedForUpsert: number;
  filesQueuedForDelete: number;
}

export class SyncLocalReconcileService {
  constructor(private readonly deps: SyncLocalReconcileServiceDeps) {}

  async reconcileOnce(): Promise<ReconcileOnceResult> {
    const store = this.requireStore();
    const remoteVaultKey = this.deps.getRemoteVaultKey();
    const localFiles = await this.deps.scanner.listFiles();
    const localPaths = new Set(localFiles.map((file) => file.path));
    const knownEntries = await this.filterKnownEntries(store);
    const pendingDeleteEntriesByPath = await this.indexPendingDeleteEntriesByPath(
      store,
      remoteVaultKey,
      knownEntries,
    );
    const renameCandidates = new Map<string, LocalSyncEntryRow[]>();
    const reusedEntryIds = new Set<string>();
    let filesQueuedForUpsert = 0;
    let filesQueuedForDelete = 0;

    for (const entry of knownEntries) {
      if (entry.deleted || !entry.path || localPaths.has(entry.path) || !entry.hash) {
        continue;
      }

      const bucket = renameCandidates.get(entry.hash) ?? [];
      bucket.push(entry);
      renameCandidates.set(entry.hash, bucket);
    }

    const hashInputs: ReconcileHashInput[] = [];
    for (const file of localFiles) {
      const existing = await store.getLocalStateByPath(file.path);
      const pendingDeleteEntry = pendingDeleteEntriesByPath.get(file.path) ?? null;
      const existingHasPendingDelete =
        !!existing && pendingDeleteEntry?.entryId === existing.entryId;
      const restoredDeletedEntry = existing ? null : pendingDeleteEntry;
      if (!existingHasPendingDelete && canSkipHash(existing, file)) {
        continue;
      }

      hashInputs.push({
        file,
        existing,
        existingHasPendingDelete,
        restoredDeletedEntry,
      });
    }

    const hashedFiles = await mapWithConcurrency(
      hashInputs,
      this.deps.hashConcurrency ?? DEFAULT_RECONCILE_HASH_CONCURRENCY,
      async (input) => ({
        ...input,
        hash: await hashBytes(await input.file.readBytes()),
      }),
    );

    for (const {
      file,
      existing,
      existingHasPendingDelete,
      restoredDeletedEntry,
      hash,
    } of hashedFiles) {
      if (
        existing &&
        !existingHasPendingDelete &&
        !existing.deleted &&
        existing.hash === hash
      ) {
        await store.applyLocalState({
          ...existing,
          localMtime: file.mtime,
          localSize: file.size,
        });
        continue;
      }

      const renameMatch =
        !existing && !restoredDeletedEntry
          ? takeRenameCandidate(renameCandidates, hash)
          : null;
      const entry = existing ?? restoredDeletedEntry ?? renameMatch;
      if (renameMatch) {
        reusedEntryIds.add(renameMatch.entryId);
      }
      const remote = entry
        ? await store.getRemoteStateById(entry.entryId)
        : await getVisibleRemoteEntryByPath(store, file.path);
      const entryId = entry?.entryId ?? remote?.entryId ?? (await store.getOrCreateEntryId(file.path));

      const queued = await queueLocalUpsertMutation(store, {
        remoteVaultKey,
        path: file.path,
        entryId,
        base: remote,
        previousLocal: entry,
        hash,
        requireBaseBlob: shouldRequireBaseBlob(file.path, remote),
      });
      await store.applyLocalState({
        entryId: queued.entryId,
        path: file.path,
        blobId: queued.blobId,
        hash,
        deleted: false,
        updatedAt: Date.now(),
        localMtime: file.mtime,
        localSize: file.size,
      });
      filesQueuedForUpsert += 1;
    }

    for (const entry of knownEntries) {
      if (
        entry.deleted ||
        !entry.path ||
        localPaths.has(entry.path) ||
        reusedEntryIds.has(entry.entryId)
      ) {
        continue;
      }

      const remote = await store.getRemoteStateById(entry.entryId);
      if (!remote || remote.revision === 0) {
        await store.markEntryClean(entry.entryId);
        await store.deleteEntry(entry.entryId);
        continue;
      }

      const deletedPath = entry.path;
      await queueLocalDeleteMutation(store, {
        remoteVaultKey,
        entryId: entry.entryId,
        base: remote,
        path: deletedPath,
      });
      await store.applyLocalState({
        entryId: entry.entryId,
        path: null,
        blobId: null,
        hash: null,
        deleted: true,
        updatedAt: Date.now(),
        localMtime: null,
        localSize: null,
      });
      filesQueuedForDelete += 1;
    }

    await store.flush();

    return {
      filesScanned: localFiles.length,
      filesQueuedForUpsert,
      filesQueuedForDelete,
    };
  }

  private requireStore(): SyncLocalReconcileStore {
    const store = this.deps.getSyncStore();
    if (!store) {
      throw new Error("Sync store is not initialized.");
    }

    return store;
  }

  private async filterKnownEntries(
    store: SyncLocalReconcileStore,
  ): Promise<LocalSyncEntryRow[]> {
    const knownEntries = await store.listLocalStates();
    const retainedEntries: LocalSyncEntryRow[] = [];

    for (const entry of knownEntries) {
      if (!entry.path || entry.deleted || this.deps.shouldSyncPath(entry.path)) {
        retainedEntries.push(entry);
        continue;
      }

      await store.markEntryClean(entry.entryId);
      const remote = await store.getRemoteStateById(entry.entryId);
      if (!remote || remote.revision === 0) {
        await store.deleteEntry(entry.entryId);
      }
    }

    return retainedEntries;
  }

  private async indexPendingDeleteEntriesByPath(
    store: SyncLocalReconcileStore,
    remoteVaultKey: Uint8Array,
    entries: LocalSyncEntryRow[],
  ): Promise<Map<string, LocalSyncEntryRow>> {
    const entriesById = new Map(entries.map((entry) => [entry.entryId, entry]));
    const result = new Map<string, LocalSyncEntryRow>();

    for (const entry of entries) {
      const pending = await store.getDirtyEntryMutation(entry.entryId);
      if (!pending || pending.op !== "delete") {
        continue;
      }

      const metadata = await decryptSyncMetadata(
        remoteVaultKey,
        pending.encryptedMetadata,
        {
          entryId: pending.entryId,
          revision: pending.baseRevision + 1,
          op: pending.op,
          blobId: pending.blobId,
        },
      );
      const pendingEntry = entriesById.get(pending.entryId);
      if (pendingEntry) {
        result.set(metadata.path, pendingEntry);
      }
    }

    return result;
  }
}

interface ReconcileHashInput {
  file: LocalSyncFile;
  existing: LocalSyncEntryRow | null;
  existingHasPendingDelete: boolean;
  restoredDeletedEntry: LocalSyncEntryRow | null;
}

function canSkipHash(
  existing: LocalSyncEntryRow | null,
  file: LocalSyncFile,
): boolean {
  return (
    !!existing &&
    !existing.deleted &&
    !!existing.hash &&
    existing.localMtime === file.mtime &&
    existing.localSize === file.size
  );
}

function takeRenameCandidate(
  candidates: Map<string, LocalSyncEntryRow[]>,
  hash: string,
): LocalSyncEntryRow | null {
  const bucket = candidates.get(hash);
  if (!bucket || bucket.length === 0) {
    return null;
  }

  const match = bucket.shift() ?? null;
  if (bucket.length === 0) {
    candidates.delete(hash);
  }

  return match;
}

async function getVisibleRemoteEntryByPath(
  store: SyncLocalReconcileStore,
  path: string,
): Promise<RemoteSyncEntryRow | null> {
  const visible = await store.getEntryByPath(path);
  return visible ? await store.getRemoteStateById(visible.entryId) : null;
}

function shouldRequireBaseBlob(
  path: string,
  remote: RemoteSyncEntryRow | null,
): boolean {
  return !!remote && !remote.deleted && !!remote.blobId && isAutoMergeTextPath(path);
}

async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<U>,
): Promise<U[]> {
  if (items.length === 0) {
    return [];
  }

  const results = new Array<U>(items.length);
  let nextIndex = 0;
  let firstError: unknown = null;
  const normalizedConcurrency = Number.isFinite(concurrency) ? Math.floor(concurrency) : 1;
  const workerCount = Math.max(1, Math.min(normalizedConcurrency, items.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length && !firstError) {
        const index = nextIndex;
        nextIndex += 1;
        try {
          results[index] = await mapper(items[index]);
        } catch (error) {
          firstError = firstError ?? error;
        }
      }
    }),
  );

  if (firstError) {
    throw firstError;
  }

  return results;
}
