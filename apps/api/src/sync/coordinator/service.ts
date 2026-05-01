import type {
	CommitMutationMessage,
	CommitMutationResult,
	CommitMutationsMessage,
	CommitMutationsResult,
	EntryStatesListedMessage,
	EntryVersionsListedMessage,
	ListEntryStatesMessage,
	ListEntryVersionsMessage,
	RestoreEntryVersionMessage,
	RestoreEntryVersionResult,
	SocketSession,
} from "./types";
import type { SyncTokenService } from "../access/token-service";
import { blobObjectKeyPrefix } from "../blob/object-key";
import { BlobRepository } from "../blob/repository";
import { BlobSyncService } from "./blob/sync-service";
import { CoordinatorControlMessageHandler } from "./socket/control-message-handler";
import { EntryHistoryService } from "./entry/history-service";
import { EntrySyncService } from "./entry/sync-service";
import { HealthSyncService } from "./health/sync-service";
import type {
	CoordinatorMaintenanceScheduler,
	MaintenanceJobKey,
} from "./maintenance-scheduler";
import { MutationCommitService } from "./mutation/commit-service";
import { CoordinatorSocketService } from "./socket/service";
import { CoordinatorStateRepository } from "./state-repository";
import type { VaultSyncStatusRepository } from "../health/status-repository";

const DEFAULT_BLOB_GRACE_PERIOD_MS = 30 * 60 * 1000;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CURSOR_ACTIVE_TTL_MS = 30 * DAY_IN_MS;

export class CoordinatorService {
	private vaultPurged = false;
	private readonly blobSyncService: BlobSyncService;
	private readonly controlMessageHandler: CoordinatorControlMessageHandler;
	private readonly entryHistoryService: EntryHistoryService;
	private readonly entrySyncService: EntrySyncService;
	private readonly healthSyncService: HealthSyncService;
	private readonly mutationCommitService: MutationCommitService;

	constructor(
		private readonly syncTokenService: SyncTokenService,
		private readonly stateRepository: CoordinatorStateRepository,
		private readonly socketService: CoordinatorSocketService,
		private readonly blobRepository: BlobRepository,
		syncStatusRepository: VaultSyncStatusRepository | null = null,
		blobGracePeriodMs = DEFAULT_BLOB_GRACE_PERIOD_MS,
		cursorActiveTtlMs = DEFAULT_CURSOR_ACTIVE_TTL_MS,
		private maintenanceScheduler: CoordinatorMaintenanceScheduler | null = null,
	) {
		this.healthSyncService = new HealthSyncService(
			stateRepository,
			syncStatusRepository,
			cursorActiveTtlMs,
			async (key, timestamp, now) => await this.deferMaintenance(key, timestamp, now),
		);
		this.blobSyncService = new BlobSyncService(
			syncTokenService,
			stateRepository,
			socketService,
			blobRepository,
			blobGracePeriodMs,
			async (key, timestamp, now) => await this.deferMaintenance(key, timestamp, now),
			async (now) => await this.markHealthSummaryDirty(now),
		);
		this.entryHistoryService = new EntryHistoryService(
			stateRepository,
			async (vaultId) => await this.readVersionHistoryRetentionMs(vaultId),
			async (session, message, options) =>
				await this.commitMutation(session, message, options),
		);
		this.entrySyncService = new EntrySyncService(
			stateRepository,
			cursorActiveTtlMs,
			async (key, timestamp, now) => await this.deferMaintenance(key, timestamp, now),
			async (now) => await this.markHealthSummaryDirty(now),
		);
		this.mutationCommitService = new MutationCommitService(
			stateRepository,
			blobRepository,
			blobGracePeriodMs,
			async (vaultId) => await this.readVersionHistoryRetentionMs(vaultId),
			async (key, timestamp, now) => await this.deferMaintenance(key, timestamp, now),
			async (now) => await this.markHealthSummaryDirty(now),
		);
		this.controlMessageHandler = new CoordinatorControlMessageHandler(
			socketService,
			stateRepository,
			{
				ackCursor: async (session, cursor) => await this.ackCursor(session, cursor),
				commitMutations: async (session, message) =>
					await this.commitMutations(session, message),
				listEntryStates: (session, message) =>
					this.listEntryStates(session, message),
				listEntryVersions: async (session, message) =>
					await this.listEntryVersions(session, message),
				restoreEntryVersion: async (session, message) =>
					await this.restoreEntryVersion(session, message),
			},
			async () => await this.markHealthSummaryDirty(),
		);
	}

	setMaintenanceScheduler(scheduler: CoordinatorMaintenanceScheduler): void {
		this.maintenanceScheduler = scheduler;
	}

	async openSocket(request: Request, vaultId: string): Promise<Response> {
		return await this.socketService.openSocket(
			request,
			vaultId,
			this.syncTokenService,
			this.stateRepository,
			async (now) => await this.markHealthSummaryDirty(now),
		);
	}

	listEntryStates(
		session: SocketSession,
		message: ListEntryStatesMessage,
	): EntryStatesListedMessage {
		return this.entrySyncService.listEntryStates(session, message);
	}

	async ackCursor(session: SocketSession, cursor: number): Promise<{ cursor: number }> {
		return await this.entrySyncService.ackCursor(session, cursor);
	}

	async listEntryVersions(
		session: SocketSession,
		message: ListEntryVersionsMessage,
	): Promise<EntryVersionsListedMessage> {
		return await this.entryHistoryService.listEntryVersions(session, message);
	}

	async restoreEntryVersion(
		session: SocketSession,
		message: RestoreEntryVersionMessage,
	): Promise<RestoreEntryVersionResult> {
		return await this.entryHistoryService.restoreEntryVersion(session, message);
	}

	async stageBlob(
		request: Request,
		vaultId: string,
		blobId: string,
		sizeBytes: number,
	): Promise<void> {
		await this.blobSyncService.stageBlob(request, vaultId, blobId, sizeBytes);
	}

	async abortStagedBlob(request: Request, vaultId: string, blobId: string): Promise<void> {
		await this.blobSyncService.abortStagedBlob(request, vaultId, blobId);
	}

	async deleteBlob(request: Request, vaultId: string, blobId: string): Promise<void> {
		await this.blobSyncService.deleteBlob(request, vaultId, blobId);
	}

	async purgeVault(vaultId: string): Promise<void> {
		this.vaultPurged = true;
		this.socketService.closeAllSockets(4403, "vault deleted");
		await this.blobRepository.deleteByPrefix(blobObjectKeyPrefix(vaultId));
		await this.stateRepository.purgeVaultState();
	}

	async handleSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
		await this.controlMessageHandler.handle(ws, message);
	}

	async commitMutations(
		session: SocketSession,
		message: CommitMutationsMessage,
		options: { forcedHistoryBefore?: "before_restore" | null } = {},
	): Promise<CommitMutationsResult> {
		return await this.mutationCommitService.commitMutations(session, message, options);
	}

	async commitMutation(
		session: SocketSession,
		message: CommitMutationMessage,
		options: { forcedHistoryBefore?: "before_restore" | null } = {},
	): Promise<CommitMutationResult> {
		return await this.mutationCommitService.commitMutation(session, message, options);
	}

	async runGc(
		vaultId?: string,
		options: {
			now?: number;
			scheduleHealthFlush?: boolean;
			scheduleNextGc?: boolean;
		} = {},
	): Promise<number | null> {
		return await this.blobSyncService.runGc(vaultId, options);
	}

	async handleAlarm(): Promise<void> {
		if (this.vaultPurged) {
			return;
		}
		if (!this.maintenanceScheduler) {
			return;
		}
		await this.maintenanceScheduler.drain();
	}

	async handleSocketClose(): Promise<void> {
		if (this.vaultPurged) {
			return;
		}
		await this.markHealthSummaryDirty();
	}

	async flushHealthSummary(
		options: { force?: boolean; now?: number; throwOnError?: boolean } = {},
	): Promise<void> {
		await this.healthSyncService.flushSummary(options);
	}

	private async markHealthSummaryDirty(now = Date.now()): Promise<void> {
		await this.healthSyncService.markSummaryDirty(now);
	}

	private async deferMaintenance(
		key: MaintenanceJobKey,
		timestamp: number,
		now = Date.now(),
	): Promise<void> {
		await this.maintenanceScheduler?.defer(key, timestamp, now);
	}

	private async readVersionHistoryRetentionMs(vaultId: string): Promise<number> {
		this.stateRepository.rememberVaultId(vaultId);
		return this.stateRepository.readVersionHistoryRetentionDays() * DAY_IN_MS;
	}

}
