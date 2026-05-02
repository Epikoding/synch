import type { BlobRepository } from "../../blob/repository";
import { blobObjectKey } from "../../blob/object-key";
import type { MaintenanceJobKey } from "../maintenance-scheduler";
import type { CoordinatorStateRepository } from "../state-repository";
import type {
	CommitMutationMessage,
	CommitMutationResult,
	CommitMutationsMessage,
	CommitMutationsResult,
	SocketSession,
} from "../types";

export class MutationCommitService {
	constructor(
		private readonly stateRepository: CoordinatorStateRepository,
		private readonly blobRepository: BlobRepository,
		private readonly blobGracePeriodMs: number,
		private readonly readVersionHistoryRetentionMs: (vaultId: string) => Promise<number>,
		private readonly deferMaintenance: (
			key: MaintenanceJobKey,
			timestamp: number,
			now?: number,
		) => Promise<void>,
		private readonly scheduleHealthSummaryFlush: (now?: number) => Promise<void>,
	) {}

	async commitMutations(
		session: SocketSession,
		message: CommitMutationsMessage,
		options: { forcedHistoryBefore?: "before_restore" | null } = {},
	): Promise<CommitMutationsResult> {
		const upsertBlobIds = new Set(
			message.mutations
				.filter((mutation) => mutation.op === "upsert" && mutation.blobId)
				.map((mutation) => mutation.blobId as string),
		);
		const unavailableBlobIds = new Set<string>();
		await Promise.all(
			Array.from(upsertBlobIds, async (blobId) => {
				const blobExists = await this.blobRepository.exists(
					blobObjectKey(session.vaultId, blobId),
				);
				if (!blobExists) {
					unavailableBlobIds.add(blobId);
				}
			}),
		);

		const result = await this.stateRepository.commitMutations(
			session,
			message,
			this.blobGracePeriodMs,
			await this.readVersionHistoryRetentionMs(session.vaultId),
			{
				...options,
				unavailableBlobIds,
			},
		);
		if (result.broadcastCursor !== null) {
			const nextGcAt = this.stateRepository.nextBlobGcAt();
			if (nextGcAt !== null) {
				await this.deferMaintenance("blob_gc", nextGcAt);
			}
			await this.scheduleHealthSummaryFlush();
		}
		return result;
	}

	async commitMutation(
		session: SocketSession,
		message: CommitMutationMessage,
		options: { forcedHistoryBefore?: "before_restore" | null } = {},
	): Promise<CommitMutationResult> {
		const batch = await this.commitMutations(
			session,
			{
				type: "commit_mutations",
				requestId: message.requestId,
				mutations: [message.mutation],
			},
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
}
