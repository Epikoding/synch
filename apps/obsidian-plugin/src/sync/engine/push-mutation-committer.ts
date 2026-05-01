import { writeConflictCopy } from "../core/conflict-file";
import { decryptSyncMetadata, encryptSyncMetadata } from "../core/crypto";
import type { SyncTokenResponse } from "../remote/client";
import {
  type CommitAcceptedResult,
  type CommitMutationBatchResult,
  SyncRealtimeError,
  type SyncRealtimeSession,
} from "../remote/realtime-client";
import type { PendingMutationRow } from "../store/store";
import { PushMutationPreparer } from "./push-mutation-preparer";
import {
  isLocalAheadStaleRevision,
  isPullResolvableStaleRevision,
  isSkippedPushMutation,
  metadataContextFromMutation,
} from "./push-mutation-shared";
import { isAutoMergeTextPath } from "./text-merge-policy";
import type {
  PreparedPushMutation,
  PreparePushMutationResult,
  PushConflictEvent,
  PushMutationCommitResult,
  PushMutationCommitterDeps,
  PushMutationStore,
} from "./push-mutation-types";

export type {
  LocalFileReader,
  PreparedPushMutation,
  PreparePushMutationResult,
  PushConflictEvent,
  PushMutationCommitResult,
  PushMutationCommitterDeps,
  PushMutationStore,
  SkippedPushMutation,
} from "./push-mutation-types";

export class PushMutationCommitter {
  private readonly mutationPreparer: PushMutationPreparer;

  constructor(private readonly deps: PushMutationCommitterDeps) {
    this.mutationPreparer = new PushMutationPreparer(deps);
  }

  async commitMutation(
    store: PushMutationStore,
    token: SyncTokenResponse,
    session: SyncRealtimeSession,
    mutation: PendingMutationRow,
  ): Promise<PushMutationCommitResult> {
    const prepared = await this.mutationPreparer.prepareMutationForCommit(
      store,
      token,
      mutation,
      session.maxFileSizeBytes,
    );
    if (!prepared || isSkippedPushMutation(prepared)) {
      return {
        status: "requeued",
        filesCreatedOrUpdated: 0,
        filesDeleted: 0,
        conflictsCreated: 0,
        shouldPullAfterPush: false,
      };
    }

    return await this.commitPreparedMutation(store, session, mutation, prepared);
  }

  async prepareMutationForCommit(
    store: PushMutationStore,
    token: SyncTokenResponse,
    mutation: PendingMutationRow,
    maxFileSizeBytes: number,
    storageAvailableBytes: number | null = null,
  ): Promise<PreparePushMutationResult> {
    return await this.mutationPreparer.prepareMutationForCommit(
      store,
      token,
      mutation,
      maxFileSizeBytes,
      storageAvailableBytes,
    );
  }

  async commitPreparedMutation(
    store: PushMutationStore,
    session: SyncRealtimeSession,
    mutation: PendingMutationRow,
    prepared: PreparedPushMutation,
  ): Promise<PushMutationCommitResult> {
    let accepted;
    try {
      accepted = await session.commitMutation(prepared.commitPayload);
    } catch (error) {
      if (isPullResolvableStaleRevision(error)) {
        return {
          status: "stale",
          filesCreatedOrUpdated: 0,
          filesDeleted: 0,
          conflictsCreated: 0,
          shouldPullAfterPush: true,
        };
      }
      const handledConflict = await this.handleLocalAheadConflict(store, mutation, error);
      if (handledConflict) {
        return {
          status: "conflict",
          filesCreatedOrUpdated: 0,
          filesDeleted: 0,
          conflictsCreated: handledConflict.conflictPath ? 1 : 0,
          shouldPullAfterPush: false,
        };
      }

      throw error;
    }

    await this.applyAcceptedMutation(store, mutation, prepared, accepted);
    await store.clearDirtyEntryByMutationId(mutation.mutationId);

    return {
      status: "accepted",
      accepted,
      filesCreatedOrUpdated: mutation.op === "upsert" ? 1 : 0,
      filesDeleted: mutation.op === "delete" ? 1 : 0,
      conflictsCreated: 0,
      shouldPullAfterPush: false,
    };
  }

  async applyAcceptedPreparedMutation(
    store: PushMutationStore,
    mutation: PendingMutationRow,
    prepared: PreparedPushMutation,
    accepted: CommitAcceptedResult,
  ): Promise<PushMutationCommitResult> {
    await this.applyAcceptedMutation(store, mutation, prepared, accepted);
    await store.clearDirtyEntryByMutationId(mutation.mutationId);

    return {
      status: "accepted",
      accepted,
      filesCreatedOrUpdated: mutation.op === "upsert" ? 1 : 0,
      filesDeleted: mutation.op === "delete" ? 1 : 0,
      conflictsCreated: 0,
      shouldPullAfterPush: false,
    };
  }

  async handleRejectedPreparedMutation(
    store: PushMutationStore,
    mutation: PendingMutationRow,
    rejected: Extract<CommitMutationBatchResult, { status: "rejected" }>,
  ): Promise<PushMutationCommitResult> {
    if (isPullResolvableStaleRevision(rejected)) {
      return {
        status: "stale",
        filesCreatedOrUpdated: 0,
        filesDeleted: 0,
        conflictsCreated: 0,
        shouldPullAfterPush: true,
      };
    }
    const handledConflict = await this.handleLocalAheadConflict(
      store,
      mutation,
      rejected,
    );
    if (handledConflict) {
      return {
        status: "conflict",
        filesCreatedOrUpdated: 0,
        filesDeleted: 0,
        conflictsCreated: handledConflict.conflictPath ? 1 : 0,
        shouldPullAfterPush: false,
      };
    }

    throw new SyncRealtimeError(rejected.code, rejected.message);
  }

  private async applyAcceptedMutation(
    store: PushMutationStore,
    mutation: PendingMutationRow,
    prepared: PreparedPushMutation,
    accepted: CommitAcceptedResult,
  ): Promise<void> {
    if (mutation.op === "delete") {
      const metadata = await decryptSyncMetadata(
        this.deps.getRemoteVaultKey(),
        mutation.encryptedMetadata,
        metadataContextFromMutation(mutation),
      );
      await store.applyRemoteState({
        entryId: mutation.entryId,
        path: metadata.path,
        revision: accepted.revision,
        blobId: null,
        hash: null,
        deleted: true,
        updatedAt: Date.now(),
      });
      await this.applyAcceptedPendingState(store, mutation, {
        revision: accepted.revision,
        blobId: null,
        hash: null,
      });
      return;
    }

    const metadata = await decryptSyncMetadata(
      this.deps.getRemoteVaultKey(),
      mutation.encryptedMetadata,
      metadataContextFromMutation(mutation),
    );
    await store.applyRemoteState({
      entryId: mutation.entryId,
      path: metadata.path,
      revision: accepted.revision,
      blobId: prepared.commitPayload.blobId,
      hash: prepared.localHash,
      deleted: false,
      updatedAt: Date.now(),
    });
    if (
      isAutoMergeTextPath(metadata.path) &&
      prepared.commitPayload.blobId &&
      prepared.encryptedBytes
    ) {
      await store.putBlob({
        blobId: prepared.commitPayload.blobId,
        hash: prepared.localHash,
        encryptedBytes: prepared.encryptedBytes,
        role: "remote",
        refEntryId: mutation.entryId,
        cachedAt: Date.now(),
      });
    }
    const local = await store.getLocalStateById(mutation.entryId);
    if (!local || (local.hash === mutation.hash && local.path === metadata.path)) {
      await store.applyLocalState({
        entryId: mutation.entryId,
        path: metadata.path,
        blobId: prepared.commitPayload.blobId,
        hash: prepared.localHash,
        deleted: false,
        updatedAt: Date.now(),
        localMtime: local?.localMtime ?? null,
        localSize: local?.localSize ?? null,
      });
    }
    await this.applyAcceptedPendingState(store, mutation, {
      revision: accepted.revision,
      blobId: prepared.commitPayload.blobId,
      hash: prepared.localHash,
    });
  }

  private async applyAcceptedPendingState(
    store: PushMutationStore,
    mutation: PendingMutationRow,
    acceptedBase: {
      revision: number;
      blobId: string | null;
      hash: string | null;
    },
  ): Promise<void> {
    const currentPending = await store.getDirtyEntryMutation(mutation.entryId);
    if (!currentPending) {
      return;
    }

    if (currentPending.mutationId === mutation.mutationId) {
      await store.clearDirtyEntryByMutationId(mutation.mutationId);
      return;
    }

    await this.rebasePendingMutation(store, currentPending, acceptedBase);
  }

  private async rebasePendingMutation(
    store: PushMutationStore,
    pending: PendingMutationRow,
    acceptedBase: {
      revision: number;
      blobId: string | null;
      hash: string | null;
    },
  ): Promise<void> {
    const metadata = await decryptSyncMetadata(
      this.deps.getRemoteVaultKey(),
      pending.encryptedMetadata,
      metadataContextFromMutation(pending),
    );
    await store.updateDirtyEntry({
      ...pending,
      baseRevision: acceptedBase.revision,
      baseBlobId: acceptedBase.blobId,
      baseHash: acceptedBase.hash,
      encryptedMetadata: await encryptSyncMetadata(
        this.deps.getRemoteVaultKey(),
        metadata,
        {
          entryId: pending.entryId,
          revision: acceptedBase.revision + 1,
          op: pending.op,
          blobId: pending.blobId,
        },
      ),
    });
  }

  private async handleLocalAheadConflict(
    store: PushMutationStore,
    mutation: PendingMutationRow,
    error: unknown,
  ): Promise<PushConflictEvent | null> {
    if (!isLocalAheadStaleRevision(error)) {
      return null;
    }

    const metadata = await decryptSyncMetadata(
      this.deps.getRemoteVaultKey(),
      mutation.encryptedMetadata,
      metadataContextFromMutation(mutation),
    );
    const conflictPath =
      mutation.op === "upsert"
        ? await this.writeConflictCopy(
            metadata.path,
            await this.deps.fileReader.readBytes(metadata.path),
          )
        : null;

    await store.clearDirtyEntryByMutationId(mutation.mutationId);
    const event = {
      entryId: mutation.entryId,
      op: mutation.op,
      originalPath: metadata.path,
      conflictPath,
    };
    this.deps.onConflict?.(event);
    return event;
  }

  private async writeConflictCopy(path: string, bytes: Uint8Array): Promise<string> {
    const writer = this.deps.conflictFileWriter;
    if (!writer) {
      throw new Error("Conflict file writer is not configured.");
    }

    return await writeConflictCopy(writer, path, bytes, this.deps.now);
  }
}
