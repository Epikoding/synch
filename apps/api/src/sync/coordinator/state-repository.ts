import { drizzle } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";

import type {
	BlobRow,
	CommitMutationMessage,
	CommitMutationResult,
	CommitMutationsMessage,
	CommitMutationsResult,
	CurrentEntryRow,
	DeletedEntryListRow,
	DeletedEntryPageCursor,
	EntryStatePageCursor,
	EntryStateRow,
	EntryVersionListRow,
	EntryVersionPageCursor,
	EntryVersionReason,
	EntryVersionRow,
	SocketSession,
	StorageStatusSnapshot,
} from "./types";
import * as doSchema from "../../db/do";
import type { VaultSyncStatusSummary } from "../health/types";
import doMigrations from "../../../drizzle-do/migrations";
import { CoordinatorBlobStore } from "./store/blob-store";
import { CoordinatorCursorStore } from "./store/cursor-store";
import type { VaultStateLimits } from "./store/cursor-store";
import { CoordinatorEntryStore } from "./store/entry-store";
import { CoordinatorHealthStore } from "./store/health-store";
import { CoordinatorHistoryStore } from "./store/history-store";
import { CoordinatorMutationStore } from "./store/mutation-store";

export class CoordinatorStateRepository {
	private readonly blobStore: CoordinatorBlobStore;
	private readonly cursorStore: CoordinatorCursorStore;
	private readonly entryStore: CoordinatorEntryStore;
	private readonly healthStore: CoordinatorHealthStore;
	private readonly historyStore: CoordinatorHistoryStore;
	private readonly mutationStore: CoordinatorMutationStore;

	constructor(private readonly ctx: DurableObjectState) {
		this.blobStore = new CoordinatorBlobStore(ctx.storage);
		this.cursorStore = new CoordinatorCursorStore(ctx.storage);
		this.entryStore = new CoordinatorEntryStore(ctx.storage);
		this.healthStore = new CoordinatorHealthStore(ctx);
		this.historyStore = new CoordinatorHistoryStore(ctx.storage);
		this.mutationStore = new CoordinatorMutationStore(ctx.storage);
	}

	async migrate(): Promise<void> {
		const db = drizzle(this.ctx.storage, { schema: doSchema });
		await migrate(db, doMigrations);
	}

	currentCursor(): number {
		return this.cursorStore.currentCursor();
	}

	ensureVaultState(vaultId: string, initialLimits: VaultStateLimits): void {
		this.cursorStore.ensureVaultState(vaultId, initialLimits);
	}

	readVaultId(): string | null {
		return this.cursorStore.readVaultId();
	}

	vaultStateExistsFor(vaultId: string): boolean {
		const existingVaultId = this.readVaultId();
		if (!existingVaultId) {
			return false;
		}
		if (existingVaultId !== vaultId) {
			throw new Error("durable object vault id mismatch");
		}
		return true;
	}

	async purgeVaultState(): Promise<void> {
		await this.ctx.storage.deleteAll();
	}

	recordLocalVaultConnection(userId: string, localVaultId: string): void {
		this.cursorStore.recordLocalVaultConnection(userId, localVaultId);
	}

	deleteLocalVaultConnection(userId: string, localVaultId: string): void {
		this.cursorStore.deleteLocalVaultConnection(userId, localVaultId);
	}

	recordGcCompleted(now = Date.now()): void {
		this.healthStore.recordGcCompleted(now);
	}

	recordHealthSummaryFlushed(now = Date.now()): void {
		this.healthStore.recordHealthSummaryFlushed(now);
	}

	recordHealthSummaryFlushFailed(error: unknown, now = Date.now()): number {
		return this.healthStore.recordHealthSummaryFlushFailed(error, now);
	}

	readHealthSummary(
		now: number,
		activeCursorTtlMs: number,
	): VaultSyncStatusSummary | null {
		return this.healthStore.readHealthSummary(now, activeCursorTtlMs);
	}

	readStorageStatus(): StorageStatusSnapshot {
		return this.healthStore.readStorageStatus();
	}

	readVaultLimits(): {
		storageLimitBytes: number;
		maxFileSizeBytes: number;
		versionHistoryRetentionDays: number;
	} {
		const row = this.ctx.storage.sql
			.exec<{
				storage_limit_bytes: number;
				max_file_size_bytes: number;
				version_history_retention_days: number;
			}>(
				`
				SELECT
					storage_limit_bytes,
					max_file_size_bytes,
					version_history_retention_days
				FROM coordinator_state
				WHERE id = 1
				`,
			)
			.toArray()[0];
		if (!row) {
			throw new Error("vault sync state is not initialized");
		}
		return {
			storageLimitBytes: Number(row.storage_limit_bytes),
			maxFileSizeBytes: Number(row.max_file_size_bytes),
			versionHistoryRetentionDays: Number(row.version_history_retention_days),
		};
	}

	applyVaultPolicy(
		vaultId: string,
		limits: {
			storageLimitBytes: number;
			maxFileSizeBytes: number;
			versionHistoryRetentionDays: number;
		},
	): boolean {
		const existingVaultId = this.readVaultId();
		if (!existingVaultId) {
			return false;
		}
		if (existingVaultId !== vaultId) {
			throw new Error("durable object vault id mismatch");
		}

		this.ctx.storage.sql.exec(
			`
			UPDATE coordinator_state
			SET
				storage_limit_bytes = ?,
				max_file_size_bytes = ?,
				version_history_retention_days = ?
			WHERE id = 1
			`,
			limits.storageLimitBytes,
			limits.maxFileSizeBytes,
			limits.versionHistoryRetentionDays,
		);
		return true;
	}

	readVersionHistoryRetentionDays(): number {
		return this.readVaultLimits().versionHistoryRetentionDays;
	}

	listEntryStates(
		sinceCursor: number,
		targetCursor: number,
		after: EntryStatePageCursor | null,
		limit: number,
	): EntryStateRow[] {
		return this.entryStore.listEntryStates(sinceCursor, targetCursor, after, limit);
	}

	countEntryStates(sinceCursor: number, targetCursor: number): number {
		return this.entryStore.countEntryStates(sinceCursor, targetCursor);
	}

	listDeletedEntries(
		before: DeletedEntryPageCursor | null,
		retentionStart: number,
		limit: number,
	): DeletedEntryListRow[] {
		return this.entryStore.listDeletedEntries(before, retentionStart, limit);
	}

	async stageBlob(
		blobId: string,
		sizeBytes: number,
		now: number,
		deleteAfter: number,
	): Promise<void> {
		await this.blobStore.stageBlob(
			blobId,
			sizeBytes,
			now,
			deleteAfter,
		);
	}

	readBlob(blobId: string): BlobRow | null {
		return this.blobStore.readBlob(blobId);
	}

	deleteBlobRecord(blobId: string): void {
		this.blobStore.deleteBlobRecord(blobId);
	}

	abortStagedBlob(blobId: string, now = Date.now()): void {
		this.blobStore.abortStagedBlob(blobId, now);
	}

	isBlobPinned(blobId: string, includeStaging = true, now = Date.now()): boolean {
		return this.blobStore.isBlobPinned(blobId, includeStaging, now);
	}

	readEntry(entryId: string): CurrentEntryRow | null {
		return this.entryStore.readEntry(entryId);
	}

	listEntryVersions(
		entryId: string,
		before: EntryVersionPageCursor | null,
		retentionStart: number,
		limit: number,
	): EntryVersionListRow[] {
		return this.historyStore.listEntryVersions(
			entryId,
			before,
			retentionStart,
			limit,
		);
	}

	readEntryVersion(
		entryId: string,
		versionId: string,
		retentionStart: number,
	): EntryVersionRow | null {
		return this.historyStore.readEntryVersion(entryId, versionId, retentionStart);
	}

	async commitMutation(
		session: SocketSession,
		message: CommitMutationMessage,
		stageGracePeriodMs: number,
		versionHistoryRetentionMs: number,
		options: { forcedHistoryBefore?: EntryVersionReason | null } = {},
	): Promise<CommitMutationResult> {
		return await this.mutationStore.commitMutation(
			session,
			message,
			stageGracePeriodMs,
			versionHistoryRetentionMs,
			options,
		);
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
		return await this.mutationStore.commitMutations(
			session,
			message,
			stageGracePeriodMs,
			versionHistoryRetentionMs,
			options,
		);
	}

	listBlobsReadyForDeletion(now: number, limit: number): BlobRow[] {
		return this.blobStore.listBlobsReadyForDeletion(now, limit);
	}

	deleteBlobIfCollectible(blobId: string, now = Date.now()): void {
		this.blobStore.deleteBlobIfCollectible(blobId, now);
	}

	nextBlobGcAt(): number | null {
		return this.blobStore.nextBlobGcAt();
	}
}
