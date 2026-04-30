import { describe, expect, it, vi } from "vitest";

import { VaultPurgeConsumer } from "./purge-consumer";

describe("VaultPurgeConsumer", () => {
	it("purges coordinator state and hard deletes the vault", async () => {
		const vaultService = {
			markVaultPurgeRunning: vi.fn(async () => {}),
			markVaultPurgeFailed: vi.fn(async () => {}),
			hardDeleteVault: vi.fn(async () => {}),
		};
		const coordinatorProxyRepository = {
			purgeVault: vi.fn(async () => new Response(null, { status: 204 })),
		};
		const consumer = new VaultPurgeConsumer(
			vaultService as never,
			coordinatorProxyRepository as never,
		);

		await consumer.purgeVault("vault-1");

		expect(vaultService.markVaultPurgeRunning).toHaveBeenCalledWith("vault-1");
		expect(coordinatorProxyRepository.purgeVault).toHaveBeenCalledWith("vault-1");
		expect(vaultService.hardDeleteVault).toHaveBeenCalledWith("vault-1");
		expect(vaultService.markVaultPurgeFailed).not.toHaveBeenCalled();
	});

	it("marks purge failures before retrying the queue message", async () => {
		const vaultService = {
			markVaultPurgeRunning: vi.fn(async () => {}),
			markVaultPurgeFailed: vi.fn(async () => {}),
			hardDeleteVault: vi.fn(async () => {}),
		};
		const coordinatorProxyRepository = {
			purgeVault: vi.fn(async () => new Response(null, { status: 500 })),
		};
		const message = {
			body: { type: "vault_purge", vaultId: "vault-1" },
			ack: vi.fn(),
			retry: vi.fn(),
		};
		const consumer = new VaultPurgeConsumer(
			vaultService as never,
			coordinatorProxyRepository as never,
		);

		await consumer.handleBatch({
			messages: [message],
		} as never);

		expect(vaultService.markVaultPurgeFailed).toHaveBeenCalledWith(
			"vault-1",
			"coordinator purge failed with status 500",
		);
		expect(vaultService.hardDeleteVault).not.toHaveBeenCalled();
		expect(message.retry).toHaveBeenCalledOnce();
		expect(message.ack).not.toHaveBeenCalled();
	});
});
