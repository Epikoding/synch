import { createQueueConsumer, createRuntimeApp } from "./runtime";
import type { QueueMessage } from "./runtime";
export { SyncCoordinator } from "./sync-coordinator";

export default {
	async fetch(request, env): Promise<Response> {
		return await createRuntimeApp(env, request).fetch(request);
	},
	async queue(batch, env): Promise<void> {
		await createQueueConsumer(env).handleBatch(batch);
	},
} satisfies ExportedHandler<Env, QueueMessage>;
