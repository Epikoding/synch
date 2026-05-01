import type { MaintenanceJobKey } from "../maintenance-scheduler";
import type { CoordinatorStateRepository } from "../state-repository";
import type { VaultSyncStatusRepository } from "../../health/status-repository";

const HEALTH_SUMMARY_DIRTY_WRITE_INTERVAL_MS = 60 * 1000;
const DEFAULT_HEALTH_SUMMARY_FLUSH_DELAY_MS = 60 * 1000;

export class HealthSyncService {
	private lastDirtyWriteAt: number | null = null;
	private scheduledFlushAt: number | null = null;

	constructor(
		private readonly stateRepository: CoordinatorStateRepository,
		private readonly syncStatusRepository: VaultSyncStatusRepository | null,
		private readonly cursorActiveTtlMs: number,
		private readonly deferMaintenance: (
			key: MaintenanceJobKey,
			timestamp: number,
			now?: number,
		) => Promise<void>,
	) {}

	async markSummaryDirty(now = Date.now()): Promise<void> {
		if (
			this.lastDirtyWriteAt === null ||
			now - this.lastDirtyWriteAt >= HEALTH_SUMMARY_DIRTY_WRITE_INTERVAL_MS
		) {
			this.stateRepository.markHealthSummaryDirty(now);
			this.lastDirtyWriteAt = now;
		}

		const flushAt = now + DEFAULT_HEALTH_SUMMARY_FLUSH_DELAY_MS;
		if (this.scheduledFlushAt !== null && this.scheduledFlushAt <= flushAt) {
			return;
		}

		await this.deferMaintenance("health_summary_flush", flushAt, now);
		this.scheduledFlushAt = flushAt;
	}

	async flushSummary(
		options: { force?: boolean; now?: number; throwOnError?: boolean } = {},
	): Promise<void> {
		if (!this.syncStatusRepository) {
			return;
		}
		if (!options.force && !this.stateRepository.isHealthSummaryDirty()) {
			return;
		}

		const now = options.now ?? Date.now();
		const summary = this.stateRepository.readHealthSummary(now, this.cursorActiveTtlMs);
		if (!summary) {
			return;
		}

		try {
			await this.syncStatusRepository.upsert(summary, now);
			this.stateRepository.recordHealthSummaryFlushed(now);
			this.lastDirtyWriteAt = null;
			this.scheduledFlushAt = null;
		} catch (error) {
			this.stateRepository.recordHealthSummaryFlushFailed(error, now);
			this.lastDirtyWriteAt = now;
			this.scheduledFlushAt = null;
			if (options.throwOnError) {
				throw error;
			}
			await this.deferMaintenance("health_summary_flush", now, now);
		}
	}
}
