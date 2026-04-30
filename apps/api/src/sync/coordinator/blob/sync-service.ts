import type { SubscriptionPolicyReader } from "../../../subscription/policy-service";
import { apiError } from "../../../errors";
import type { SyncTokenService } from "../../access/token-service";
import { blobObjectKey } from "../../blob/object-key";
import type { BlobRepository } from "../../blob/repository";
import type { MaintenanceJobKey } from "../maintenance-scheduler";
import type { CoordinatorSocketService } from "../socket/service";
import type { CoordinatorStateRepository } from "../state-repository";

const GC_BATCH_SIZE = 64;

export class BlobSyncService {
	constructor(
		private readonly syncTokenService: SyncTokenService,
		private readonly stateRepository: CoordinatorStateRepository,
		private readonly socketService: CoordinatorSocketService,
		private readonly blobRepository: BlobRepository,
		private readonly subscriptionPolicyService: SubscriptionPolicyReader,
		private readonly blobGracePeriodMs: number,
		private readonly deferMaintenance: (
			key: MaintenanceJobKey,
			timestamp: number,
			now?: number,
		) => Promise<void>,
		private readonly markHealthSummaryDirty: (now?: number) => Promise<void>,
	) {}

	async stageBlob(
		request: Request,
		vaultId: string,
		blobId: string,
		sizeBytes: number,
	): Promise<void> {
		const claims = await this.syncTokenService.requireSyncToken(request, vaultId);
		this.stateRepository.rememberVaultId(claims.vaultId);
		const policy = await this.subscriptionPolicyService.readVaultPolicy(claims.vaultId);
		if (
			policy.limits.maxFileSizeBytes > 0 &&
			sizeBytes > policy.limits.maxFileSizeBytes
		) {
			throw apiError(
				413,
				"file_too_large",
				`blob exceeds maximum file size of ${policy.limits.maxFileSizeBytes} bytes`,
			);
		}

		const now = Date.now();
		try {
			await this.stateRepository.stageBlob(
				blobId,
				sizeBytes,
				policy.limits.storageLimitBytes,
				now,
				now + this.blobGracePeriodMs,
			);
			await this.deferMaintenance("blob_gc", now + this.blobGracePeriodMs, now);
			await this.markHealthSummaryDirty(now);
			this.broadcastStorageStatus(policy.limits.storageLimitBytes);
		} catch (error) {
			if (error instanceof Error && error.message.includes("already live")) {
				throw apiError(409, "conflict", error.message);
			}
			if (error instanceof Error && error.message.includes("quota exceeded")) {
				throw apiError(413, "quota_exceeded", error.message);
			}
			if (error instanceof Error && error.message.includes("size changed")) {
				throw apiError(409, "conflict", error.message);
			}
			throw error;
		}
	}

	async abortStagedBlob(
		request: Request,
		vaultId: string,
		blobId: string,
	): Promise<void> {
		const claims = await this.syncTokenService.requireSyncToken(request, vaultId);
		this.stateRepository.rememberVaultId(claims.vaultId);
		this.stateRepository.abortStagedBlob(blobId, Date.now());
		await this.markHealthSummaryDirty();
		this.broadcastStorageStatus();
	}

	async deleteBlob(request: Request, vaultId: string, blobId: string): Promise<void> {
		const claims = await this.syncTokenService.requireSyncToken(request, vaultId);
		this.stateRepository.rememberVaultId(claims.vaultId);
		const blob = this.stateRepository.readBlob(blobId);
		if (blob && this.stateRepository.isBlobPinned(blobId, false)) {
			return;
		}

		await this.blobRepository.delete(blobObjectKey(vaultId, blobId));
		if (blob) {
			this.stateRepository.deleteBlobRecord(blobId);
			await this.markHealthSummaryDirty();
			this.broadcastStorageStatus();
		}
	}

	async runGc(
		vaultId?: string,
		options: {
			now?: number;
			scheduleHealthFlush?: boolean;
			scheduleNextGc?: boolean;
		} = {},
	): Promise<number | null> {
		const effectiveVaultId = vaultId ?? this.stateRepository.readVaultId();
		if (!effectiveVaultId) {
			return null;
		}

		const now = options.now ?? Date.now();
		const due = this.stateRepository.listBlobsReadyForDeletion(now, GC_BATCH_SIZE);
		for (const blob of due) {
			await this.blobRepository.delete(blobObjectKey(effectiveVaultId, blob.blob_id));
			this.stateRepository.deleteBlobIfCollectible(blob.blob_id, now);
		}

		const nextGcAt = this.stateRepository.nextBlobGcAt();
		if ((options.scheduleNextGc ?? true) && nextGcAt !== null) {
			await this.deferMaintenance("blob_gc", nextGcAt, now);
		}
		this.stateRepository.recordGcCompleted(now);
		if (options.scheduleHealthFlush ?? true) {
			await this.deferMaintenance("health_summary_flush", now, now);
		}
		if (due.length > 0) {
			this.broadcastStorageStatus();
		}
		return nextGcAt;
	}

	private broadcastStorageStatus(storageLimitBytes?: number): void {
		const storageStatus = this.stateRepository.readStorageStatus();
		this.socketService.broadcastStorageStatus({
			type: "storage_status_updated",
			storageStatus: {
				...storageStatus,
				storageLimitBytes: storageLimitBytes ?? storageStatus.storageLimitBytes,
			},
		});
	}
}
