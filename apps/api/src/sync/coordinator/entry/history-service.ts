import { apiError } from "../../../errors";
import type {
	CommitMutationMessage,
	CommitMutationResult,
	EntryVersionsListedMessage,
	ListEntryVersionsMessage,
	RestoreEntryVersionMessage,
	RestoreEntryVersionResult,
	SocketSession,
} from "../types";
import type { CoordinatorStateRepository } from "../state-repository";

const MAX_HISTORY_BATCH = 100;

export class EntryHistoryService {
	constructor(
		private readonly stateRepository: CoordinatorStateRepository,
		private readonly readVersionHistoryRetentionMs: (vaultId: string) => Promise<number>,
		private readonly commitMutation: (
			session: SocketSession,
			message: CommitMutationMessage,
			options?: { forcedHistoryBefore?: "before_restore" | null },
		) => Promise<CommitMutationResult>,
	) {}

	async listEntryVersions(
		session: SocketSession,
		message: ListEntryVersionsMessage,
	): Promise<EntryVersionsListedMessage> {
		this.stateRepository.rememberVaultId(session.vaultId);
		const versionHistoryRetentionMs = await this.readVersionHistoryRetentionMs(
			session.vaultId,
		);
		const retentionStart = Date.now() - versionHistoryRetentionMs;
		const effectiveLimit = Math.min(message.limit, MAX_HISTORY_BATCH);
		const versions = this.stateRepository.listEntryVersions(
			message.entryId,
			message.before,
			retentionStart,
			effectiveLimit + 1,
		);
		const hasMore = versions.length > effectiveLimit;
		const page = hasMore ? versions.slice(0, effectiveLimit) : versions;
		if (page.length === 0 && !this.stateRepository.readEntry(message.entryId)) {
			throw apiError(404, "not_found", "entry history not found");
		}
		const last = page.at(-1);

		return {
			type: "entry_versions_listed",
			requestId: message.requestId,
			entryId: message.entryId,
			versions: page.map((version) => ({
				versionId: version.version_id,
				sourceRevision: version.source_revision,
				op: version.op_type,
				blobId: version.blob_id,
				encryptedMetadata: version.encrypted_metadata,
				reason: version.reason,
				capturedAt: version.captured_at,
			})),
			hasMore,
			nextBefore:
				hasMore && last
					? {
							capturedAt: last.captured_at,
							versionId: last.version_id,
						}
					: null,
		};
	}

	async restoreEntryVersion(
		session: SocketSession,
		message: RestoreEntryVersionMessage,
	): Promise<RestoreEntryVersionResult> {
		this.stateRepository.rememberVaultId(session.vaultId);
		const versionHistoryRetentionMs = await this.readVersionHistoryRetentionMs(
			session.vaultId,
		);
		const retentionStart = Date.now() - versionHistoryRetentionMs;

		const current = this.stateRepository.readEntry(message.entryId);
		if (!current) {
			throw apiError(404, "not_found", "entry not found");
		}

		const target = this.stateRepository.readEntryVersion(
			message.entryId,
			message.versionId,
			retentionStart,
		);
		if (!target) {
			throw apiError(404, "not_found", "requested version was not found");
		}

		if (current.revision !== message.baseRevision) {
			throw apiError(
				409,
				"stale_revision",
				`expected base revision ${current.revision} but received ${message.baseRevision}`,
			);
		}

		if (target.op_type !== message.op || target.blob_id !== message.blobId) {
			throw apiError(
				409,
				"version_mismatch",
				"restore payload does not match the requested version",
			);
		}

		const committed = await this.commitMutation(
			session,
			{
				type: "commit_mutation",
				requestId: message.requestId,
				mutation: {
					mutationId: crypto.randomUUID(),
					entryId: message.entryId,
					op: message.op,
					baseRevision: message.baseRevision,
					blobId: message.blobId,
					encryptedMetadata: message.encryptedMetadata,
				},
			},
			{
				forcedHistoryBefore: "before_restore",
			},
		);

		if (committed.message.type !== "commit_accepted") {
			throw apiError(
				409,
				"code" in committed.message
					? committed.message.code
					: "restore_commit_failed",
				"message" in committed.message
					? committed.message.message
					: "entry version restore could not be committed",
			);
		}

		return {
			message: {
				type: "entry_version_restored",
				requestId: message.requestId,
				entryId: message.entryId,
				restoredFromVersionId: message.versionId,
				restoredFromRevision: target.source_revision,
				cursor: committed.message.cursor,
				revision: committed.message.revision,
			},
			broadcastCursor: committed.broadcastCursor,
		};
	}
}
