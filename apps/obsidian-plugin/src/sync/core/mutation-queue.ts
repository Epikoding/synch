import { encryptSyncMetadata } from "./crypto";
import type { SyncMutationStore } from "../store/ports";
import type { PendingMutationRow } from "../store/store";

export type PendingMutationWriter = Pick<SyncMutationStore, "replaceDirtyEntry">;

export interface ReplacePendingMutationInput {
  entryId: string;
  op: "upsert" | "delete";
  baseRevision: number;
  baseBlobId: string | null;
  baseHash: string | null;
  blobId: string | null;
  hash: string | null;
  encryptedMetadata: string;
  createdAt?: number;
  requireBaseBlob?: boolean;
}

export async function replacePendingMutationForEntry(
  store: PendingMutationWriter,
  input: ReplacePendingMutationInput,
): Promise<PendingMutationRow> {
  const queued: PendingMutationRow = {
    mutationId: crypto.randomUUID(),
    entryId: input.entryId,
    op: input.op,
    baseRevision: input.baseRevision,
    baseBlobId: input.baseBlobId,
    baseHash: input.baseHash,
    blobId: input.blobId,
    hash: input.hash,
    encryptedMetadata: input.encryptedMetadata,
    createdAt: input.createdAt ?? Date.now(),
  };

  await store.replaceDirtyEntry(queued, {
    requireBaseBlob: input.requireBaseBlob,
  });
  return queued;
}

export interface QueueLocalUpsertMutationInput {
  remoteVaultKey: Uint8Array;
  path: string;
  entryId: string;
  base: MutationBase | null | undefined;
  previousLocal?: MutationLocalContent | null | undefined;
  hash: string;
  requireBaseBlob?: boolean;
}

export interface MutationBase {
  revision: number;
  deleted: boolean;
  blobId: string | null;
  hash: string | null;
}

export interface MutationLocalContent {
  deleted: boolean;
  blobId: string | null;
  hash: string | null;
}

export interface QueuedLocalUpsertMutation {
  entryId: string;
  blobId: string;
  mutation: PendingMutationRow;
}

export async function queueLocalUpsertMutation(
  store: PendingMutationWriter,
  input: QueueLocalUpsertMutationInput,
): Promise<QueuedLocalUpsertMutation> {
  const queued = await buildLocalUpsertMutation(input);
  await store.replaceDirtyEntry(queued.mutation, {
    requireBaseBlob: input.requireBaseBlob,
  });

  return queued;
}

export async function buildLocalUpsertMutation(
  input: QueueLocalUpsertMutationInput,
): Promise<QueuedLocalUpsertMutation> {
  const entryId = input.entryId;
  const baseRevision = input.base?.revision ?? 0;
  const blobId = createNextBlobId(input.previousLocal ?? input.base, input.hash);
  const mutation: PendingMutationRow = {
    mutationId: crypto.randomUUID(),
    entryId,
    op: "upsert",
    baseRevision,
    baseBlobId: input.base?.blobId ?? null,
    baseHash: input.base?.hash ?? null,
    blobId,
    hash: input.hash,
    encryptedMetadata: await encryptSyncMetadata(
      input.remoteVaultKey,
      {
        path: input.path,
        hash: input.hash,
      },
      {
        entryId,
        revision: baseRevision + 1,
        op: "upsert",
        blobId,
      },
    ),
    createdAt: Date.now(),
  };

  return {
    entryId,
    blobId,
    mutation,
  };
}

export interface QueueLocalDeleteMutationInput {
  remoteVaultKey: Uint8Array;
  entryId: string;
  base: MutationBase;
  path: string;
}

export async function queueLocalDeleteMutation(
  store: PendingMutationWriter,
  input: QueueLocalDeleteMutationInput,
): Promise<PendingMutationRow> {
  const mutation = await buildLocalDeleteMutation(input);
  await store.replaceDirtyEntry(mutation);
  return mutation;
}

export async function buildLocalDeleteMutation(
  input: QueueLocalDeleteMutationInput,
): Promise<PendingMutationRow> {
  return {
    mutationId: crypto.randomUUID(),
    entryId: input.entryId,
    op: "delete",
    baseRevision: input.base.revision,
    baseBlobId: input.base.blobId,
    baseHash: input.base.hash,
    blobId: null,
    hash: null,
    encryptedMetadata: await encryptSyncMetadata(
      input.remoteVaultKey,
      {
        path: input.path,
        hash: null,
      },
      {
        entryId: input.entryId,
        revision: input.base.revision + 1,
        op: "delete",
        blobId: null,
      },
    ),
    createdAt: Date.now(),
  };
}

export function createNextBlobId(
  entry:
    | {
        deleted: boolean;
        blobId: string | null;
        hash: string | null;
      }
    | null
    | undefined,
  hash: string,
): string {
  if (entry && !entry.deleted && entry.hash === hash && entry.blobId) {
    return entry.blobId;
  }

  return crypto.randomUUID();
}
