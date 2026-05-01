import { SyncTokenService } from "../sync/access/token-service";
import { BlobRepository } from "../sync/blob/repository";
import { CoordinatorMaintenanceScheduler } from "../sync/coordinator/maintenance-scheduler";
import { createCoordinatorApp } from "../sync/coordinator/routes";
import { CoordinatorService } from "../sync/coordinator/service";
import { CoordinatorSocketService } from "../sync/coordinator/socket/service";
import { CoordinatorStateRepository } from "../sync/coordinator/state-repository";
import { VaultSyncStatusRepository } from "../sync/health/status-repository";

export function createCoordinatorRuntime(ctx: DurableObjectState, env: Env) {
	const stateRepository = new CoordinatorStateRepository(ctx);
	const socketService = new CoordinatorSocketService(ctx);
	const blobRepository = new BlobRepository(env.SYNC_BLOBS);
	const syncStatusRepository = new VaultSyncStatusRepository(env.DB);
	const syncTokenService = new SyncTokenService(env.SYNC_TOKEN_SECRET);
	const coordinatorService = new CoordinatorService(
		syncTokenService,
		stateRepository,
		socketService,
		blobRepository,
		syncStatusRepository,
	);
	const maintenanceScheduler = new CoordinatorMaintenanceScheduler(ctx, {
		blob_gc: async (now) => {
			return await coordinatorService.runGc(undefined, {
				now,
				scheduleHealthFlush: true,
				scheduleNextGc: false,
			});
		},
		health_summary_flush: async (now) => {
			await coordinatorService.flushHealthSummary({
				now,
				throwOnError: true,
			});
			return null;
		},
	});
	coordinatorService.setMaintenanceScheduler(maintenanceScheduler);
	const ready = ctx.blockConcurrencyWhile(async () => {
		await stateRepository.migrate();
		await maintenanceScheduler.ensureArmed();
	});

	return {
		app: createCoordinatorApp({
			coordinatorService,
		}),
		coordinatorService,
		ready,
	};
}
