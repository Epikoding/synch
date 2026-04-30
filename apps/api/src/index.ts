import { createRuntimeApp, createVaultPurgeConsumer } from "./runtime";
import type { VaultPurgeMessage } from "./runtime";
export { SyncCoordinator } from "./sync-coordinator";

export default {
	async fetch(request, env): Promise<Response> {
		return await createRuntimeApp(env, request).fetch(request);
	},
	async queue(batch, env): Promise<void> {
		await createVaultPurgeConsumer(env).handleBatch(batch);
	},
} satisfies ExportedHandler<Env, VaultPurgeMessage>;
