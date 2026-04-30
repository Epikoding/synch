import { createDb } from "../db/client";
import { SubscriptionPolicyService } from "../subscription/policy-service";
import { CoordinatorProxyRepository } from "../sync/coordinator/proxy-repository";
import { VaultPurgeConsumer } from "../vault/purge-consumer";
import type { VaultPurgeMessage } from "../vault/purge-queue";
import { VaultRepository } from "../vault/repository";
import { VaultService } from "../vault/service";

export function createVaultPurgeConsumer(env: Env): VaultPurgeConsumer {
	const db = createDb(env.DB);
	const vaultRepository = new VaultRepository(db);
	const subscriptionPolicyService = new SubscriptionPolicyService(env.SELF_HOSTED, db);
	const vaultService = new VaultService(vaultRepository, subscriptionPolicyService);
	const coordinatorProxyRepository = new CoordinatorProxyRepository(env.SYNC_COORDINATOR);
	return new VaultPurgeConsumer(vaultService, coordinatorProxyRepository);
}

export type { VaultPurgeMessage };
