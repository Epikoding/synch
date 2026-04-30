import { describe, expect, it } from "vitest";

import { getSubscriptionPlanPolicy } from "./policy";
import {
	SubscriptionPolicyService,
	subscriptionGrantsAccess,
} from "./policy-service";

describe("SubscriptionPolicyService", () => {
	it("uses the hosted free policy by default", async () => {
		const policy = await new SubscriptionPolicyService().readOrganizationPolicy("org-1");

		expect(policy.id).toBe("free");
		expect(policy.limits.syncedVaults).toBe(1);
		expect(policy.limits.storageLimitBytes).toBe(50_000_000);
		expect(policy.limits.maxFileSizeBytes).toBe(3_000_000);
	});

	it("uses unlimited quota limits for self-hosted deployments", async () => {
		const policy = await new SubscriptionPolicyService(true).readOrganizationPolicy("org-1");

		expect(policy.id).toBe("self_hosted");
		expect(policy.limits.syncedVaults).toBe(0);
		expect(policy.limits.storageLimitBytes).toBe(0);
		expect(policy.limits.maxFileSizeBytes).toBe(0);
		expect(policy.limits.versionHistoryRetentionDays).toBe(1);
	});

	it("defines the hosted starter plan limits", () => {
		const policy = getSubscriptionPlanPolicy("starter");

		expect(policy.pricing.monthlyUsd).toBe(1);
		expect(policy.limits.storageLimitBytes).toBe(1_000_000_000);
		expect(policy.limits.maxFileSizeBytes).toBe(5_000_000);
		expect(policy.limits.versionHistoryRetentionDays).toBe(1);
	});

	it("keeps period-scoped subscription access until the paid period ends", () => {
		const future = new Date(Date.now() + 60_000);
		const past = new Date(Date.now() - 60_000);

		expect(subscriptionGrantsAccess({ status: "canceled", periodEnd: future })).toBe(
			true,
		);
		expect(subscriptionGrantsAccess({ status: "past_due", periodEnd: future })).toBe(
			true,
		);
		expect(subscriptionGrantsAccess({ status: "unpaid", periodEnd: future })).toBe(
			true,
		);
		expect(subscriptionGrantsAccess({ status: "canceled", periodEnd: past })).toBe(
			false,
		);
		expect(subscriptionGrantsAccess({ status: "canceled", periodEnd: null })).toBe(
			false,
		);
	});
});
