import { createApp } from "../app";
import { createAuth } from "../auth";
import { BillingRepository } from "../billing/repository";
import { createPolarAuthPlugin } from "../billing/polar";
import { BillingService } from "../billing/service";
import { resolveOriginBinding, resolveUrlBinding } from "../config/env";
import { createDb } from "../db/client";
import { CloudflareSubscriptionPolicyRefreshQueue } from "../subscription/policy-refresh-queue";
import { SubscriptionPolicyService } from "../subscription/policy-service";
import { SyncService } from "../sync/access/service";
import { SyncTokenService } from "../sync/access/token-service";
import { BlobRepository } from "../sync/blob/repository";
import { CoordinatorProxyRepository } from "../sync/coordinator/proxy-repository";
import { CloudflareVaultPurgeQueue } from "../vault/purge-queue";
import { VaultRepository } from "../vault/repository";
import { VaultService } from "../vault/service";

type RuntimeEnv = Omit<Env, "AUTH_EMAIL_FROM" | "DEV_MODE" | "EMAIL"> & {
	EMAIL?: SendEmail;
	AUTH_EMAIL_FROM?: string;
	DEV_MODE?: boolean | string;
	WWW_BASE_URL?: string;
	POLAR_ACCESS_TOKEN?: string;
	POLAR_WEBHOOK_SECRET?: string;
	POLAR_STARTER_PRODUCT_ID?: string;
	POLAR_SANDBOX?: string;
};

export function createRuntimeApp(env: RuntimeEnv, request: Request) {
	const requestOrigin = new URL(request.url).origin;
	const authBaseUrl = resolveUrlBinding("BETTER_AUTH_URL", env.BETTER_AUTH_URL, requestOrigin);
	const publicOrigin = new URL(authBaseUrl).origin;
	const corsOrigin = resolveOriginBinding(
		"WWW_BASE_URL",
		env.WWW_BASE_URL,
		"http://localhost:4321",
	);
	const db = createDb(env.DB);
	const billingRepository = new BillingRepository(db);
	const productIdsByPlanId = {
		starter: env.POLAR_STARTER_PRODUCT_ID,
	};
	const polarConfig = {
		accessToken: env.POLAR_ACCESS_TOKEN,
		webhookSecret: env.POLAR_WEBHOOK_SECRET,
		sandbox: resolveBooleanBinding(env.POLAR_SANDBOX, false),
		publicBaseUrl: authBaseUrl,
	};
	const vaultRepository = new VaultRepository(db);
	const coordinatorProxyRepository = new CoordinatorProxyRepository(env.SYNC_COORDINATOR);
	const subscriptionPolicyService = new SubscriptionPolicyService(env.SELF_HOSTED, db, {
		productIdsByPlanId,
	});
	const subscriptionPolicyRefreshQueue =
		new CloudflareSubscriptionPolicyRefreshQueue(env.POLICY_REFRESH_QUEUE);
	const polarAuthPlugin = env.SELF_HOSTED
		? null
		: createPolarAuthPlugin(polarConfig, billingRepository, {
				onSubscriptionUpsert: async (organizationId) => {
					await subscriptionPolicyRefreshQueue.enqueueOrganizationPolicyRefresh(
						organizationId,
					);
				},
			});
	const auth = createAuth(env.DB, {
		baseURL: authBaseUrl,
		trustedOrigins: Array.from(new Set([publicOrigin, corsOrigin])),
		selfHosted: env.SELF_HOSTED,
		devMode: resolveBooleanBinding(env.DEV_MODE, false),
		email: env.EMAIL,
		emailFrom: env.AUTH_EMAIL_FROM,
		plugins: polarAuthPlugin ? [polarAuthPlugin] : [],
	});
	const blobRepository = new BlobRepository(env.SYNC_BLOBS);
	const syncTokenService = new SyncTokenService(env.SYNC_TOKEN_SECRET);
	const billingService = new BillingService(billingRepository, {
		...polarConfig,
		productIdsByPlanId,
		wwwBaseUrl: corsOrigin,
	});
	const vaultPurgeQueue = new CloudflareVaultPurgeQueue(env.VAULT_PURGE_QUEUE);
	const vaultService = new VaultService(
		vaultRepository,
		subscriptionPolicyService,
		vaultPurgeQueue,
	);
	const syncService = new SyncService(
		vaultService,
		syncTokenService,
		env.SYNC_TOKEN_TTL_SECONDS,
	);

	const app = createApp(
		{
			auth,
			syncService,
			vaultService,
			syncTokenService,
			blobRepository,
			coordinatorProxyRepository,
			subscriptionPolicyService,
			billingService,
		},
		{
			publicOrigin,
			corsOrigin,
			billingEnabled: !env.SELF_HOSTED,
		},
	);

	return {
		async fetch(request: Request): Promise<Response> {
			return await app.fetch(request);
		},
	};
}

function resolveBooleanBinding(value: boolean | string | undefined, fallback: boolean): boolean {
	if (typeof value === "boolean") {
		return value;
	}
	if (value === undefined || value.trim() === "") {
		return fallback;
	}

	return value === "true" || value === "1";
}
