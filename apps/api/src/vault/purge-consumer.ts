import type { CoordinatorProxyRepository } from "../sync/coordinator/proxy-repository";
import type { VaultService } from "./service";
import type { VaultPurgeMessage } from "./purge-queue";

export class VaultPurgeConsumer {
	constructor(
		private readonly vaultService: VaultService,
		private readonly coordinatorProxyRepository: CoordinatorProxyRepository,
	) {}

	async purgeVault(vaultId: string): Promise<void> {
		await this.vaultService.markVaultPurgeRunning(vaultId);
		try {
			const response = await this.coordinatorProxyRepository.purgeVault(vaultId);
			if (!response.ok) {
				throw new Error(`coordinator purge failed with status ${response.status}`);
			}
			await this.vaultService.hardDeleteVault(vaultId);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await this.vaultService.markVaultPurgeFailed(vaultId, message);
			throw error;
		}
	}

	async handleMessage(message: Message<VaultPurgeMessage>): Promise<void> {
		const body = message.body;
		if (body?.type !== "vault_purge" || !body.vaultId.trim()) {
			message.ack();
			return;
		}

		try {
			await this.purgeVault(body.vaultId);
			message.ack();
		} catch {
			message.retry();
		}
	}

	async handleBatch(batch: MessageBatch<VaultPurgeMessage>): Promise<void> {
		for (const message of batch.messages) {
			await this.handleMessage(message);
		}
	}
}
