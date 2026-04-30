export type VaultPurgeMessage = {
	type: "vault_purge";
	vaultId: string;
};

export interface VaultPurgeQueue {
	enqueueVaultPurge(vaultId: string): Promise<void>;
}

export class CloudflareVaultPurgeQueue implements VaultPurgeQueue {
	constructor(private readonly queue: Queue<VaultPurgeMessage>) {}

	async enqueueVaultPurge(vaultId: string): Promise<void> {
		await this.queue.send({ type: "vault_purge", vaultId });
	}
}
