import { SyncBlobClient } from "../remote/blob-client";
import type { ConflictFileWriter } from "../core/conflict-file";
import type { SyncTokenResponse } from "../remote/client";
import type { SyncRealtimeSession } from "../remote/realtime-client";
import type {
  PendingMutationRow,
  SyncProgressCounts,
} from "../store/store";
import type {
  SyncCursorStore,
  SyncEntryStore,
  SyncMutationStore,
  SyncStoreLifecycle,
} from "../store/ports";
import {
  type LocalFileReader,
  PushMutationCommitter,
  type PushConflictEvent,
  type PushMutationStore,
  type PreparedPushMutation,
} from "./push-mutation-committer";

const DEFAULT_PUSH_BATCH = 100;
const DEFAULT_PUSH_DRAIN_LIMIT = 1_000;
const DEFAULT_PUSH_PREPARE_CONCURRENCY = 12;

export interface SyncPushServiceDeps {
  getApiBaseUrl: () => string;
  getSyncToken: () => Promise<SyncTokenResponse>;
  getSyncStore: () => SyncPushStore | null;
  getRemoteVaultKey: () => Uint8Array;
  fileReader: LocalFileReader;
  conflictFileWriter?: ConflictFileWriter;
  blobClient?: SyncBlobClient;
  prepareConcurrency?: number;
  onProgress: (progress: SyncProgressCounts) => Promise<void>;
  onConflict?: (event: PushConflictEvent) => void;
  onFileSizeBlockedFilesChange?: () => void;
  now?: () => number;
}

export interface SyncPushStore
  extends SyncCursorStore,
    Pick<SyncEntryStore, "countSyncProgress">,
    Pick<
      SyncMutationStore,
      "listBlockedDirtyEntriesByReason" | "listDirtyEntries" | "updateDirtyEntry"
    >,
    Pick<SyncStoreLifecycle, "flush">,
    PushMutationStore {}

export interface PushPendingMutationsResult {
  cursor: number;
  mutationsPushed: number;
  mutationsRequeued: number;
  filesCreatedOrUpdated: number;
  filesDeleted: number;
  conflictsCreated: number;
  shouldPullAfterPush: boolean;
  hasMore: boolean;
  stopReason?: "storage_quota_exceeded";
}

export class SyncPushService {
  private readonly mutationCommitter: PushMutationCommitter;

  constructor(private readonly deps: SyncPushServiceDeps) {
    this.mutationCommitter = new PushMutationCommitter({
      getApiBaseUrl: () => this.deps.getApiBaseUrl(),
      getRemoteVaultKey: () => this.deps.getRemoteVaultKey(),
      fileReader: this.deps.fileReader,
      conflictFileWriter: this.deps.conflictFileWriter,
      blobClient: this.deps.blobClient,
      onConflict: this.deps.onConflict,
      now: this.deps.now,
    });
  }

  async pushPendingMutations(
    session: SyncRealtimeSession,
  ): Promise<PushPendingMutationsResult> {
    const store = this.deps.getSyncStore();
    if (!store) {
      throw new Error("Sync store is not initialized.");
    }

    const token = await this.deps.getSyncToken();
    const startingCursor = await store.getCursor();
    let cursor = startingCursor;
    let checkpointCursor = startingCursor;
    let mutationsPushed = 0;
    let mutationsRequeued = 0;
    let filesCreatedOrUpdated = 0;
    let filesDeleted = 0;
    let conflictsCreated = 0;
    let fileSizeBlocked = 0;
    let shouldPullAfterPush = false;
    const acceptedCursors: number[] = [];
    let processedMutations = 0;
    let hasMore = false;
    let stopAfterCurrentBatch = false;
    let stopReason: PushPendingMutationsResult["stopReason"];

    try {
      while (processedMutations < DEFAULT_PUSH_DRAIN_LIMIT) {
        const remainingBudget = DEFAULT_PUSH_DRAIN_LIMIT - processedMutations;
        const pending = await store.listDirtyEntries(
          Math.min(DEFAULT_PUSH_BATCH, remainingBudget),
        );
        if (pending.length === 0) {
          hasMore = false;
          break;
        }

        const preparedMutations = await this.preparePendingMutations(
          store,
          token,
          session,
          pending,
        );

        const committable: Array<{
          mutation: (typeof preparedMutations)[number]["mutation"];
          prepared: PreparedPushMutation;
        }> = [];

        for (const { mutation, prepared } of preparedMutations) {
          processedMutations += 1;

          if (!prepared) {
            mutationsRequeued += 1;
            continue;
          }
          if ("skipped" in prepared) {
            if (prepared.reason === "file_too_large") {
              fileSizeBlocked += 1;
            }
            if (prepared.reason === "storage_quota_exceeded") {
              stopAfterCurrentBatch = true;
              stopReason = "storage_quota_exceeded";
              break;
            }
            continue;
          }

          committable.push({ mutation, prepared });
        }

        if (committable.length === 0) {
          await this.reportProgress(store);
          if (stopAfterCurrentBatch) {
            break;
          }
          continue;
        }

        const committed = await session.commitMutations(
          committable.map(({ prepared }) => prepared.commitPayload),
        );
        const resultsByMutationId = new Map(
          committed.results.map((result) => [result.mutationId, result]),
        );

        for (const { mutation, prepared } of committable) {
          const batchResult = resultsByMutationId.get(mutation.mutationId);
          if (!batchResult) {
            throw new Error(`Commit batch did not include ${mutation.mutationId}.`);
          }

          const result =
            batchResult.status === "accepted"
              ? await this.mutationCommitter.applyAcceptedPreparedMutation(
                  store,
                  mutation,
                  prepared,
                  batchResult,
                )
              : await this.mutationCommitter.handleRejectedPreparedMutation(
                  store,
                  mutation,
                  batchResult,
                );
          conflictsCreated += result.conflictsCreated;
          shouldPullAfterPush = shouldPullAfterPush || result.shouldPullAfterPush;

          if (result.status === "stale") {
            mutationsRequeued += 1;
            stopAfterCurrentBatch = true;
            continue;
          }
          if (result.status === "requeued") {
            mutationsRequeued += 1;
            continue;
          }
          if (result.status === "conflict") {
            continue;
          }
          cursor = Math.max(cursor, result.accepted.cursor);
          acceptedCursors.push(result.accepted.cursor);
          filesCreatedOrUpdated += result.filesCreatedOrUpdated;
          filesDeleted += result.filesDeleted;
          mutationsPushed += 1;
        }
        await this.reportProgress(store);
        if (stopAfterCurrentBatch) {
          break;
        }
      }

      hasMore = (await store.listDirtyEntries(1)).length > 0;
      checkpointCursor = getContiguousAcceptedCursor(
        checkpointCursor,
        acceptedCursors,
      );
      if (checkpointCursor > startingCursor) {
        await store.setCursor(checkpointCursor);
      }
      shouldPullAfterPush =
        shouldPullAfterPush ||
        acceptedCursors.some((acceptedCursor) => acceptedCursor > checkpointCursor);
    } finally {
      await store.flush();
    }

    // TODO: Refresh file-size-blocked decorations when existing blocked files become syncable.
    if (fileSizeBlocked > 0) {
      this.deps.onFileSizeBlockedFilesChange?.();
    }

    return {
      cursor,
      mutationsPushed,
      mutationsRequeued,
      filesCreatedOrUpdated,
      filesDeleted,
      conflictsCreated,
      shouldPullAfterPush,
      hasMore,
      ...(stopReason ? { stopReason } : {}),
    };
  }

  async unblockFileSizeBlockedMutations(maxFileSizeBytes: number): Promise<number> {
    const store = this.deps.getSyncStore();
    if (!store) {
      throw new Error("Sync store is not initialized.");
    }

    const blocked = await store.listBlockedDirtyEntriesByReason("file_too_large");
    let unblocked = 0;
    for (const mutation of blocked) {
      if (!shouldUnblockFileSizeMutation(mutation, maxFileSizeBytes)) {
        continue;
      }

      await store.updateDirtyEntry({
        ...mutation,
        status: "pending",
        blockedReason: null,
        blockedEncryptedSizeBytes: null,
        blockedMaxFileSizeBytes: null,
      });
      unblocked += 1;
    }

    if (unblocked > 0) {
      await store.flush();
    }

    return unblocked;
  }

  private async reportProgress(store: SyncPushStore): Promise<void> {
    const progress = await store.countSyncProgress();
    if (progress.totalEntries <= 0) {
      return;
    }

    await this.deps.onProgress(progress);
  }

  private async preparePendingMutations(
    store: SyncPushStore,
    token: SyncTokenResponse,
    session: SyncRealtimeSession,
    pending: PendingMutationRow[],
  ): Promise<
    Array<{
      mutation: (typeof pending)[number];
      prepared: Awaited<ReturnType<PushMutationCommitter["prepareMutationForCommit"]>>;
    }>
  > {
    return await mapWithConcurrency(
      pending,
      this.deps.prepareConcurrency ?? DEFAULT_PUSH_PREPARE_CONCURRENCY,
      async (mutation) => ({
        mutation,
        prepared: await this.mutationCommitter.prepareMutationForCommit(
          store,
          token,
          mutation,
          session.maxFileSizeBytes,
        ),
      }),
    );
  }
}

function getContiguousAcceptedCursor(
  currentCursor: number,
  acceptedCursors: number[],
): number {
  if (acceptedCursors.length === 0) {
    return currentCursor;
  }

  const remaining = new Set(acceptedCursors);
  let cursor = currentCursor;
  while (remaining.delete(cursor + 1)) {
    cursor += 1;
  }
  return cursor;
}

function shouldUnblockFileSizeMutation(
  mutation: PendingMutationRow,
  maxFileSizeBytes: number,
): boolean {
  if (maxFileSizeBytes === 0) {
    return true;
  }

  const encryptedSizeBytes = mutation.blockedEncryptedSizeBytes;
  return (
    typeof encryptedSizeBytes === "number" &&
    encryptedSizeBytes <= maxFileSizeBytes
  );
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
  const workerCount = normalizeConcurrency(concurrency, items.length);

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

function normalizeConcurrency(concurrency: number, itemCount: number): number {
  const normalizedConcurrency = Number.isFinite(concurrency) ? Math.floor(concurrency) : 1;
  return Math.max(1, Math.min(normalizedConcurrency, itemCount));
}
