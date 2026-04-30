import { describe, expect, it } from "vitest";
import {
	formatHistoryRetention,
	getSubscriptionPlanPolicy,
} from "../../../../subscription/policy";

describe("coordinator subscription policy", () => {
	it("uses the free plan one-day version history policy", () => {
		const policy = getSubscriptionPlanPolicy("free");

		expect(policy.limits.versionHistoryRetentionDays).toBe(1);
		expect(policy.features.snapshots).toBe(true);
		expect(
			formatHistoryRetention(
				policy.limits.versionHistoryRetentionDays,
			),
		).toBe("1 day version history");
	});
});
