import type { MaintenanceJobKey } from "../maintenance-scheduler";
import type { CoordinatorStateRepository } from "../state-repository";
import type { VaultSyncStatusRepository } from "../../health/status-repository";

const DEFAULT_HEALTH_SUMMARY_FLUSH_DELAY_MS = 10 * 60 * 1000;

export class HealthSyncService {
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

	async scheduleSummaryFlush(now = Date.now()): Promise<void> {
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

		const now = options.now ?? Date.now();
		const summary = this.stateRepository.readHealthSummary(now, this.cursorActiveTtlMs);
		if (!summary) {
			return;
		}

		try {
			await this.syncStatusRepository.upsert(summary, now);
			this.stateRepository.recordHealthSummaryFlushed(now);
			this.scheduledFlushAt = null;
		} catch (error) {
			this.stateRepository.recordHealthSummaryFlushFailed(error, now);
			this.scheduledFlushAt = null;
			if (options.throwOnError) {
				throw error;
			}
			await this.deferMaintenance("health_summary_flush", now, now);
		}
	}
}
