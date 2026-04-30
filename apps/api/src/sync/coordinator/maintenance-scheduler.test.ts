import { afterEach, describe, expect, it, vi } from "vitest";

import { CoordinatorMaintenanceScheduler } from "./maintenance-scheduler";

type TestJob = {
	key: string;
	dueAt: number;
	retryCount: number;
	lastError: string | null;
	lastErrorAt: number | null;
	updatedAt: number;
};

describe("CoordinatorMaintenanceScheduler", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("logs failed maintenance jobs while preserving retry scheduling", async () => {
		const now = 1_000;
		const job: TestJob = {
			key: "blob_gc",
			dueAt: now - 1,
			retryCount: 1,
			lastError: null,
			lastErrorAt: null,
			updatedAt: now - 1,
		};
		const ctx = createTestDurableObjectState(job);
		const error = new Error("d1 unavailable");
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		const scheduler = new CoordinatorMaintenanceScheduler(ctx, {
			blob_gc: vi.fn(async () => {
				throw error;
			}),
			health_summary_flush: vi.fn(async () => null),
		});

		await scheduler.drain(now);

		expect(job).toMatchObject({
			dueAt: 61_000,
			retryCount: 2,
			lastError: "d1 unavailable",
			lastErrorAt: now,
			updatedAt: now,
		});
		expect(ctx.storage.setAlarm).toHaveBeenCalledWith(61_000);
		expect(consoleError).toHaveBeenCalledWith(
			"[sync-coordinator] maintenance job failed",
			expect.objectContaining({
				jobKey: "blob_gc",
				dueAt: now - 1,
				failedAt: now,
				retryCount: 2,
				nextDueAt: 61_000,
				error: expect.objectContaining({
					name: "Error",
					message: "d1 unavailable",
					stack: expect.any(String),
				}),
			}),
		);
	});
});

function createTestDurableObjectState(job: TestJob): DurableObjectState {
	const storage = {
		sql: {
			exec: vi.fn((query: string, ...params: unknown[]) => {
				if (query.includes("WHERE due_at <= ?")) {
					return {
						toArray: () =>
							job.dueAt <= Number(params[0])
								? [
										{
											key: job.key,
											due_at: job.dueAt,
											retry_count: job.retryCount,
										},
									]
								: [],
					};
				}

				if (query.includes("SELECT due_at")) {
					return {
						toArray: () => [{ due_at: job.dueAt }],
					};
				}

				if (query.includes("UPDATE maintenance_jobs")) {
					job.dueAt = Number(params[0]);
					job.retryCount = Number(params[1]);
					job.lastError = String(params[2]);
					job.lastErrorAt = Number(params[3]);
					job.updatedAt = Number(params[4]);
					return { toArray: () => [] };
				}

				throw new Error(`unexpected query: ${query}`);
			}),
		},
		setAlarm: vi.fn(async () => {}),
		deleteAlarm: vi.fn(async () => {}),
		getAlarm: vi.fn(async () => null),
	};

	return { storage } as unknown as DurableObjectState;
}
