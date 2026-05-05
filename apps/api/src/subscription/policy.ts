export const BYTES_PER_MB = 1_000_000;
export const BYTES_PER_GB = 1_000_000_000;

export const SUBSCRIPTION_PLAN_IDS = ["free", "starter", "self_hosted"] as const;

export type SubscriptionPlanId = (typeof SUBSCRIPTION_PLAN_IDS)[number];
export type PaidSubscriptionPlanId = Exclude<SubscriptionPlanId, "free" | "self_hosted">;

export type SubscriptionPlanPolicy = {
	id: SubscriptionPlanId;
	name: string;
	badge?: string;
	pricing: {
		monthlyUsd: number;
		annualMonthlyUsd: number;
		annualUsd: number;
	};
	limits: {
		syncedVaults: number;
		storageLimitBytes: number;
		maxFileSizeBytes: number;
		versionHistoryRetentionDays: number;
	};
	features: {
		snapshots: boolean;
		storageUpgrade: boolean;
	};
};

export type SubscriptionPlanLimitOverrides = {
	syncedVaults?: number | null;
};

export const SUBSCRIPTION_PLAN_POLICIES = {
	free: {
		id: "free",
		name: "Sync Free",
		pricing: {
			monthlyUsd: 0,
			annualMonthlyUsd: 0,
			annualUsd: 0,
		},
		limits: {
			syncedVaults: 1,
			storageLimitBytes: 50 * BYTES_PER_MB,
			maxFileSizeBytes: 3 * BYTES_PER_MB,
			versionHistoryRetentionDays: 1,
		},
		features: {
			snapshots: true,
			storageUpgrade: false,
		},
	},
	starter: {
		id: "starter",
		name: "Sync Starter",
		badge: "$1/month",
		pricing: {
			monthlyUsd: 1,
			annualMonthlyUsd: 1,
			annualUsd: 12,
		},
		limits: {
			syncedVaults: 1,
			storageLimitBytes: BYTES_PER_GB,
			maxFileSizeBytes: 5 * BYTES_PER_MB,
			versionHistoryRetentionDays: 1,
		},
		features: {
			snapshots: true,
			storageUpgrade: false,
		},
	},
	self_hosted: {
		id: "self_hosted",
		name: "Self Hosted",
		pricing: {
			monthlyUsd: 0,
			annualMonthlyUsd: 0,
			annualUsd: 0,
		},
		limits: {
			syncedVaults: 0,
			storageLimitBytes: 0,
			maxFileSizeBytes: 0,
			versionHistoryRetentionDays: 1,
		},
		features: {
			snapshots: true,
			storageUpgrade: false,
		},
	},
} as const satisfies Record<SubscriptionPlanId, SubscriptionPlanPolicy>;

export function getSubscriptionPlanPolicy(
	planId: SubscriptionPlanId,
): SubscriptionPlanPolicy {
	return SUBSCRIPTION_PLAN_POLICIES[planId];
}

export function applySubscriptionPlanLimitOverrides(
	policy: SubscriptionPlanPolicy,
	overrides: SubscriptionPlanLimitOverrides,
): SubscriptionPlanPolicy {
	return {
		...policy,
		limits: {
			syncedVaults:
				overrides.syncedVaults ?? policy.limits.syncedVaults,
			storageLimitBytes: policy.limits.storageLimitBytes,
			maxFileSizeBytes: policy.limits.maxFileSizeBytes,
			versionHistoryRetentionDays: policy.limits.versionHistoryRetentionDays,
		},
	};
}

export function formatPolicyBytes(bytes: number): string {
	if (bytes >= BYTES_PER_GB && bytes % BYTES_PER_GB === 0) {
		return `${bytes / BYTES_PER_GB} GB`;
	}

	if (bytes >= BYTES_PER_MB && bytes % BYTES_PER_MB === 0) {
		return `${bytes / BYTES_PER_MB} MB`;
	}

	return `${bytes.toLocaleString("en-US")} bytes`;
}

export function formatHistoryRetention(days: number): string {
	if (days <= 0) {
		return "No snapshots";
	}

	if (days === 30) {
		return "1 month version history";
	}

	if (days === 365) {
		return "12 month version history";
	}

	return `${days} day version history`;
}
