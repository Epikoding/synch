import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";

import * as doSchema from "../../../db/do";
import type {
	CommitMutationBatchResult,
	CommitMutationMessage,
	CommitMutationResult,
	CommitMutationsMessage,
	CommitMutationsResult,
	EntryVersionReason,
	SocketSession,
} from "../types";
import { CoordinatorBlobStore } from "./blob-store";
import { CoordinatorCursorStore } from "./cursor-store";

const AUTO_ENTRY_VERSION_BUCKET_MS = 5 * 60 * 1000;

export class CoordinatorMutationStore {
	private readonly blobStore: CoordinatorBlobStore;
	private readonly cursorStore: CoordinatorCursorStore;

	constructor(private readonly storage: DurableObjectStorage) {
		this.blobStore = new CoordinatorBlobStore(storage);
		this.cursorStore = new CoordinatorCursorStore(storage);
	}

	async commitMutation(
		session: SocketSession,
		message: CommitMutationMessage,
		stageGracePeriodMs: number,
		versionHistoryRetentionMs: number,
		options: { forcedHistoryBefore?: EntryVersionReason | null } = {},
	): Promise<CommitMutationResult> {
		const batch = await this.commitMutations(
			session,
			{
				type: "commit_mutations",
				requestId: message.requestId,
				mutations: [message.mutation],
			},
			stageGracePeriodMs,
			versionHistoryRetentionMs,
			options,
		);
		const result = batch.message.results[0];
		if (!result) {
			throw new Error("commit batch returned no result");
		}

		if (result.status === "accepted") {
			return {
				message: {
					type: "commit_accepted",
					requestId: message.requestId,
					cursor: result.cursor,
					entryId: result.entryId,
					revision: result.revision,
				},
				broadcastCursor: batch.broadcastCursor,
			};
		}

		return {
			message: {
				type: "commit_rejected",
				requestId: message.requestId,
				code: result.code,
				message: result.message,
				expectedBaseRevision: result.expectedBaseRevision,
				receivedBaseRevision: result.receivedBaseRevision,
			},
			broadcastCursor: null,
		};
	}

	async commitMutations(
		session: SocketSession,
		message: CommitMutationsMessage,
		stageGracePeriodMs: number,
		versionHistoryRetentionMs: number,
		options: {
			forcedHistoryBefore?: EntryVersionReason | null;
			unavailableBlobIds?: ReadonlySet<string>;
		} = {},
	): Promise<CommitMutationsResult> {
		const now = Date.now();

		return this.getDb().transaction((tx) => {
			this.cursorStore.rememberVaultIdInTransaction(tx, session.vaultId);
			const results: CommitMutationBatchResult[] = [];
			let highestResponseCursor: number | null = null;
			let highestBroadcastCursor: number | null = null;
			const insertEntryVersion = (input: {
				versionId: string;
				entryId: string;
				sourceRevision: number;
				opType: "upsert" | "delete";
				blobId: string | null;
				encryptedMetadata: string;
				reason: EntryVersionReason;
				bucketStartMs: number | null;
				createdByUserId: string;
				createdByLocalVaultId: string;
				expiresAt: number;
				ignoreConflict?: boolean;
			}): boolean => {
				const existingAutoVersion =
					input.ignoreConflict && input.bucketStartMs !== null
						? tx
								.select({
									versionId: doSchema.entryVersions.versionId,
								})
								.from(doSchema.entryVersions)
								.where(
									and(
										eq(doSchema.entryVersions.entryId, input.entryId),
										eq(doSchema.entryVersions.reason, input.reason),
										eq(
											doSchema.entryVersions.bucketStartMs,
											input.bucketStartMs,
										),
									),
								)
								.limit(1)
								.get()
						: null;
				if (existingAutoVersion) {
					return false;
				}

				tx.insert(doSchema.entryVersions)
					.values({
						versionId: input.versionId,
						entryId: input.entryId,
						sourceRevision: input.sourceRevision,
						opType: input.opType,
						blobId: input.blobId,
						encryptedMetadata: input.encryptedMetadata,
						reason: input.reason,
						bucketStartMs: input.bucketStartMs,
						capturedAt: now,
						expiresAt: input.expiresAt,
						createdByUserId: input.createdByUserId,
						createdByLocalVaultId: input.createdByLocalVaultId,
					})
					.onConflictDoNothing()
					.run();

				return true;
			};

			for (const mutation of message.mutations) {
				const mutationId = mutation.mutationId.trim();
				const existingCommit = tx
					.select({
						seq: doSchema.commits.seq,
						entryId: doSchema.commits.entryId,
						revision: doSchema.commits.revision,
					})
					.from(doSchema.commits)
					.where(eq(doSchema.commits.mutationId, mutationId))
					.limit(1)
					.get();

				if (existingCommit) {
					const cursor = Number(existingCommit.seq);
					highestResponseCursor = Math.max(highestResponseCursor ?? 0, cursor);
					results.push({
						status: "accepted",
						mutationId,
						cursor,
						entryId: existingCommit.entryId,
						revision: Number(existingCommit.revision),
					});
					continue;
				}

				const current = tx
					.select({
						entryId: doSchema.entries.entryId,
						revision: doSchema.entries.revision,
						blobId: doSchema.entries.blobId,
						encryptedMetadata: doSchema.entries.encryptedMetadata,
						deleted: doSchema.entries.deleted,
						updatedSeq: doSchema.entries.updatedSeq,
					})
					.from(doSchema.entries)
					.where(eq(doSchema.entries.entryId, mutation.entryId))
					.limit(1)
					.get();

				const currentRevision = Number(current?.revision ?? 0);
				const expectedBaseRevision = Number(mutation.baseRevision);
				if (currentRevision !== expectedBaseRevision) {
					results.push({
						status: "rejected",
						mutationId,
						entryId: mutation.entryId,
						code: "stale_revision",
						message: `expected base revision ${currentRevision} but received ${expectedBaseRevision}`,
						expectedBaseRevision: currentRevision,
						receivedBaseRevision: expectedBaseRevision,
					});
					continue;
				}

				const nextBlobId = mutation.op === "delete" ? null : mutation.blobId;
				const nextDeleted = mutation.op === "delete" ? 1 : 0;
				const currentBlobId = current?.blobId ?? null;

				if (nextBlobId) {
					if (options.unavailableBlobIds?.has(nextBlobId)) {
						results.push({
							status: "rejected",
							mutationId,
							entryId: mutation.entryId,
							code: "blob_not_found",
							message: `blob ${nextBlobId} is not available`,
						});
						continue;
					}

					const nextBlobState = this.blobStore.readBlobState(tx, nextBlobId);
					if (!nextBlobState) {
						results.push({
							status: "rejected",
							mutationId,
							entryId: mutation.entryId,
							code: "blob_not_staged",
							message: `blob ${nextBlobId} was not staged`,
						});
						continue;
					}

					if (nextBlobState === "pending_delete") {
						this.blobStore.restagePendingDeleteBlob(
							tx,
							nextBlobId,
							now + stageGracePeriodMs,
						);
					}
				}

				const revision = currentRevision + 1;
				const versionExpiresAt = now + versionHistoryRetentionMs;
				const forcedHistoryBefore =
					mutation.op === "delete"
						? "before_delete"
						: options.forcedHistoryBefore ?? null;
				if (forcedHistoryBefore && current) {
					insertEntryVersion({
						versionId: crypto.randomUUID(),
						entryId: mutation.entryId,
						sourceRevision: currentRevision,
						opType: Number(current.deleted) === 1 ? "delete" : "upsert",
						blobId: current.blobId,
						encryptedMetadata: current.encryptedMetadata,
						reason: forcedHistoryBefore,
						bucketStartMs: null,
						createdByUserId: session.userId,
						createdByLocalVaultId: session.localVaultId,
						expiresAt: versionExpiresAt,
					});
				}

				tx.insert(doSchema.commits)
					.values({
						mutationId,
						entryId: mutation.entryId,
						revision,
					})
					.run();

				const committed = tx
					.select({
						seq: doSchema.commits.seq,
					})
					.from(doSchema.commits)
					.where(eq(doSchema.commits.mutationId, mutationId))
					.limit(1)
					.get();
				const cursor = Number(committed?.seq ?? 0);

				tx.insert(doSchema.entries)
					.values({
						entryId: mutation.entryId,
						revision,
						blobId: nextBlobId,
						encryptedMetadata: mutation.encryptedMetadata,
						deleted: nextDeleted,
						updatedSeq: cursor,
						updatedAt: now,
						updatedByUserId: session.userId,
						updatedByLocalVaultId: session.localVaultId,
					})
					.onConflictDoUpdate({
						target: doSchema.entries.entryId,
						set: {
							revision,
							blobId: nextBlobId,
							encryptedMetadata: mutation.encryptedMetadata,
							deleted: nextDeleted,
							updatedSeq: cursor,
							updatedAt: now,
							updatedByUserId: session.userId,
							updatedByLocalVaultId: session.localVaultId,
						},
					})
					.run();

				const shouldCaptureAutoVersion =
					!forcedHistoryBefore && expectedBaseRevision > 0;
				if (shouldCaptureAutoVersion) {
					insertEntryVersion({
						versionId: crypto.randomUUID(),
						entryId: mutation.entryId,
						sourceRevision: revision,
						opType: mutation.op,
						blobId: nextBlobId,
						encryptedMetadata: mutation.encryptedMetadata,
						reason: "auto",
						bucketStartMs:
							Math.floor(now / AUTO_ENTRY_VERSION_BUCKET_MS) *
							AUTO_ENTRY_VERSION_BUCKET_MS,
						createdByUserId: session.userId,
						createdByLocalVaultId: session.localVaultId,
						expiresAt: versionExpiresAt,
						ignoreConflict: true,
					});
				}

				if (nextBlobId) {
					this.blobStore.markBlobLive(tx, nextBlobId);
				}

				if (currentBlobId && currentBlobId !== nextBlobId) {
					this.blobStore.markBlobPendingDeleteIfUnreferenced(
						tx,
						currentBlobId,
						now,
					);
				}

				highestResponseCursor = Math.max(highestResponseCursor ?? 0, cursor);
				highestBroadcastCursor = Math.max(highestBroadcastCursor ?? 0, cursor);
				results.push({
					status: "accepted",
					mutationId,
					cursor,
					entryId: mutation.entryId,
					revision,
				});
			}

			const responseCursor =
				highestResponseCursor ?? this.cursorStore.currentCursorInTransaction(tx);
			if (highestBroadcastCursor !== null) {
				this.cursorStore.recordCommittedCursor(tx, {
					vaultId: session.vaultId,
					userId: session.userId,
					localVaultId: session.localVaultId,
					cursor: highestBroadcastCursor,
					now,
				});
			}

			return {
				message: {
					type: "commit_mutations_committed",
					requestId: message.requestId,
					cursor: responseCursor,
					results,
				},
				broadcastCursor: highestBroadcastCursor,
			} satisfies CommitMutationsResult;
		});
	}

	private getDb() {
		return drizzle(this.storage, { schema: doSchema });
	}
}
