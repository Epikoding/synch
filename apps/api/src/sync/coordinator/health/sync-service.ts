import type { MaintenanceJobKey } from "../maintenance-scheduler";
import type { CoordinatorStateRepository } from "../state-repository";
import type { VaultSyncStatusRepository } from "../../health/status-repository";

const DEFAULT_HEALTH_SUMMARY_FLUSH_DELAY_MS = 30 * 1000;

export class HealthSyncService {
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
		this.stateRepository.markHealthSummaryDirty(now);
		await this.deferMaintenance(
			"health_summary_flush",
			now + DEFAULT_HEALTH_SUMMARY_FLUSH_DELAY_MS,
			now,
		);
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
		} catch (error) {
			this.stateRepository.recordHealthSummaryFlushFailed(error, now);
			if (options.throwOnError) {
				throw error;
			}
			await this.deferMaintenance("health_summary_flush", now, now);
		}
	}
}
