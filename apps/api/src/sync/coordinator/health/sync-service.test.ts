import { describe, expect, it, vi } from "vitest";

import { HealthSyncService } from "./sync-service";
import type { CoordinatorStateRepository } from "../state-repository";
import type { VaultSyncStatusRepository } from "../../health/status-repository";

describe("HealthSyncService", () => {
	it("debounces dirty writes and flush scheduling for one minute", async () => {
		const stateRepository = createStateRepository();
		const deferMaintenance = vi.fn(async () => {});
		const service = new HealthSyncService(
			stateRepository,
			null,
			30 * 24 * 60 * 60 * 1000,
			deferMaintenance,
		);

		await service.markSummaryDirty(1_000);
		await service.markSummaryDirty(30_000);
		await service.markSummaryDirty(60_999);

		expect(stateRepository.markHealthSummaryDirty).toHaveBeenCalledTimes(1);
		expect(stateRepository.markHealthSummaryDirty).toHaveBeenCalledWith(1_000);
		expect(deferMaintenance).toHaveBeenCalledTimes(1);
		expect(deferMaintenance).toHaveBeenCalledWith(
			"health_summary_flush",
			61_000,
			1_000,
		);
	});

	it("records a new dirty write after the debounce window", async () => {
		const stateRepository = createStateRepository();
		const deferMaintenance = vi.fn(async () => {});
		const service = new HealthSyncService(
			stateRepository,
			null,
			30 * 24 * 60 * 60 * 1000,
			deferMaintenance,
		);

		await service.markSummaryDirty(1_000);
		await service.markSummaryDirty(61_000);

		expect(stateRepository.markHealthSummaryDirty).toHaveBeenCalledTimes(2);
		expect(stateRepository.markHealthSummaryDirty).toHaveBeenNthCalledWith(2, 61_000);
		expect(deferMaintenance).toHaveBeenCalledTimes(1);
	});

	it("allows the next activity to mark dirty after a successful flush", async () => {
		const stateRepository = createStateRepository({
			isHealthSummaryDirty: vi.fn(() => true),
			readHealthSummary: vi.fn(() => ({
				vaultId: "vault-1",
				healthStatus: "ok",
				healthReasons: [],
				currentCursor: 1,
				entryCount: 1,
				liveBlobCount: 1,
				stagedBlobCount: 0,
				pendingDeleteBlobCount: 0,
				storageUsedBytes: 10,
				storageLimitBytes: 100,
				activeLocalVaultCount: 1,
				websocketCount: 1,
				oldestStagedBlobAgeMs: null,
				oldestPendingDeleteAgeMs: null,
				lastCommitAt: 1_000,
				lastGcAt: null,
				lastActivityAt: 1_000,
			})),
			recordHealthSummaryFlushed: vi.fn(),
		});
		const syncStatusRepository = {
			upsert: vi.fn(async () => {}),
		} as unknown as VaultSyncStatusRepository;
		const deferMaintenance = vi.fn(async () => {});
		const service = new HealthSyncService(
			stateRepository,
			syncStatusRepository,
			30 * 24 * 60 * 60 * 1000,
			deferMaintenance,
		);

		await service.markSummaryDirty(1_000);
		await service.flushSummary({ now: 61_000 });
		await service.markSummaryDirty(62_000);

		expect(stateRepository.markHealthSummaryDirty).toHaveBeenCalledTimes(2);
		expect(stateRepository.markHealthSummaryDirty).toHaveBeenNthCalledWith(2, 62_000);
		expect(deferMaintenance).toHaveBeenCalledTimes(2);
	});
});

function createStateRepository(
	overrides: Partial<Record<keyof CoordinatorStateRepository, unknown>> = {},
): CoordinatorStateRepository {
	return {
		markHealthSummaryDirty: vi.fn(),
		isHealthSummaryDirty: vi.fn(() => false),
		readHealthSummary: vi.fn(() => null),
		recordHealthSummaryFlushed: vi.fn(),
		recordHealthSummaryFlushFailed: vi.fn(() => 1),
		...overrides,
	} as unknown as CoordinatorStateRepository;
}
