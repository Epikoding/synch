import { SyncBlobClient, SyncBlobUploadError } from "../remote/blob-client";
import { hashBytes } from "../core/content";
import { decryptSyncMetadata, encryptSyncBlob } from "../core/crypto";
import { queueLocalUpsertMutation } from "../core/mutation-queue";
import type { SyncTokenResponse } from "../remote/client";
import type { PendingMutationRow } from "../store/store";
import type {
  PreparePushMutationResult,
  PushMutationCommitterDeps,
  PushMutationStore,
} from "./push-mutation-types";
import {
  metadataContextFromMutation,
  toCommitPayload,
} from "./push-mutation-shared";

export class PushMutationPreparer {
  private readonly blobClient: SyncBlobClient;

  constructor(private readonly deps: PushMutationCommitterDeps) {
    this.blobClient = deps.blobClient ?? new SyncBlobClient();
  }

  async prepareMutationForCommit(
    store: PushMutationStore,
    token: SyncTokenResponse,
    mutation: PendingMutationRow,
    maxFileSizeBytes: number,
    storageAvailableBytes: number | null = null,
  ): Promise<PreparePushMutationResult> {
    if (mutation.op === "delete") {
      return {
        commitPayload: toCommitPayload(mutation),
        localHash: null,
        encryptedBytes: null,
        storageBytesAdded: 0,
      };
    }

    const remoteVaultKey = this.deps.getRemoteVaultKey();
    const metadata = await decryptSyncMetadata(
      remoteVaultKey,
      mutation.encryptedMetadata,
      metadataContextFromMutation(mutation),
    );
    const bytes = await this.deps.fileReader.readBytes(metadata.path);
    if (!mutation.blobId) {
      throw new Error(`Upsert mutation ${mutation.mutationId} is missing a blobId.`);
    }
    if (!mutation.hash) {
      throw new Error(`Upsert mutation ${mutation.mutationId} is missing a hash.`);
    }
    if (metadata.hash !== mutation.hash) {
      throw new Error(`Upsert mutation ${mutation.mutationId} metadata hash does not match.`);
    }
    const actualHash = await hashBytes(bytes);
    if (actualHash !== mutation.hash) {
      await this.requeueChangedUpsert(store, mutation, metadata.path, actualHash);
      return null;
    }
    const blobId = mutation.blobId;
    const encryptedBytes = await encryptSyncBlob(remoteVaultKey, bytes, { blobId });
    const storageBytesAdded =
      mutation.blobId === mutation.baseBlobId && mutation.hash === mutation.baseHash
        ? 0
        : encryptedBytes.byteLength;
    if (maxFileSizeBytes > 0 && encryptedBytes.byteLength > maxFileSizeBytes) {
      await this.blockOversizedUpsert(
        store,
        mutation,
        encryptedBytes.byteLength,
        maxFileSizeBytes,
      );
      return {
        skipped: true,
        reason: "file_too_large",
      };
    }
    if (
      storageAvailableBytes !== null &&
      storageBytesAdded > storageAvailableBytes
    ) {
      await this.blockQuotaExceededUpsert(store, mutation);
      return {
        skipped: true,
        reason: "storage_quota_exceeded",
      };
    }

    try {
      await this.blobClient.uploadBlob(
        this.deps.getApiBaseUrl(),
        token.token,
        token.vaultId,
        blobId,
        encryptedBytes,
      );
    } catch (error) {
      if (isQuotaExceededUploadError(error)) {
        await this.blockQuotaExceededUpsert(store, mutation);
        return {
          skipped: true,
          reason: "storage_quota_exceeded",
        };
      }

      throw error;
    }

    return {
      commitPayload: {
        mutationId: mutation.mutationId,
        entryId: mutation.entryId,
        op: mutation.op,
        baseRevision: mutation.baseRevision,
        blobId,
        encryptedMetadata: mutation.encryptedMetadata,
      },
      localHash: mutation.hash,
      encryptedBytes,
      storageBytesAdded,
    };
  }

  private async blockOversizedUpsert(
    store: PushMutationStore,
    mutation: PendingMutationRow,
    encryptedSizeBytes: number,
    maxFileSizeBytes: number,
  ): Promise<void> {
    await store.updateDirtyEntry({
      ...mutation,
      status: "blocked",
      blockedReason: "file_too_large",
      blockedEncryptedSizeBytes: encryptedSizeBytes,
      blockedMaxFileSizeBytes: maxFileSizeBytes,
    });
  }

  private async blockQuotaExceededUpsert(
    store: PushMutationStore,
    mutation: PendingMutationRow,
  ): Promise<void> {
    await store.updateDirtyEntry({
      ...mutation,
      status: "blocked",
      blockedReason: "storage_quota_exceeded",
    });
  }

  private async requeueChangedUpsert(
    store: PushMutationStore,
    mutation: PendingMutationRow,
    path: string,
    hash: string,
  ): Promise<void> {
    const existing = await store.getEntryById(mutation.entryId);
    const remote = await store.getRemoteStateById(mutation.entryId);
    const local = await store.getLocalStateById(mutation.entryId);
    const queued = await queueLocalUpsertMutation(store, {
      remoteVaultKey: this.deps.getRemoteVaultKey(),
      path,
      entryId: mutation.entryId,
      base: remote ?? {
        revision: mutation.baseRevision,
        deleted: false,
        blobId: mutation.baseBlobId ?? mutation.blobId,
        hash: mutation.baseHash ?? mutation.hash,
      },
      previousLocal: local ?? existing,
      hash,
    });

    await store.applyLocalState({
      entryId: queued.entryId,
      path,
      blobId: queued.blobId,
      hash,
      deleted: false,
      updatedAt: Date.now(),
      localMtime: existing?.localMtime ?? null,
      localSize: existing?.localSize ?? null,
    });
  }
}

function isQuotaExceededUploadError(error: unknown): boolean {
  return (
    error instanceof SyncBlobUploadError &&
    error.status === 413 &&
    error.code === "quota_exceeded"
  );
}
