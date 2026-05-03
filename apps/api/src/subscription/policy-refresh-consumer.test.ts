import { describe, expect, it, vi } from "vitest";

import { SubscriptionPolicyRefreshConsumer } from "./policy-refresh-consumer";

describe("SubscriptionPolicyRefreshConsumer", () => {
	it("refreshes organization policy and acknowledges the queue message", async () => {
		const policyRefreshService = {
			refreshOrganizationPolicy: vi.fn(async () => {}),
		};
		const message = {
			body: {
				type: "subscription_policy_refresh",
				organizationId: "org-1",
			},
			ack: vi.fn(),
			retry: vi.fn(),
		};
		const consumer = new SubscriptionPolicyRefreshConsumer(
			policyRefreshService as never,
		);

		await consumer.handleMessage(message as never);

		expect(policyRefreshService.refreshOrganizationPolicy).toHaveBeenCalledWith("org-1");
		expect(message.ack).toHaveBeenCalledOnce();
		expect(message.retry).not.toHaveBeenCalled();
	});

	it("retries the queue message when policy refresh fails", async () => {
		const policyRefreshService = {
			refreshOrganizationPolicy: vi.fn(async () => {
				throw new Error("coordinator unavailable");
			}),
		};
		const message = {
			body: {
				type: "subscription_policy_refresh",
				organizationId: "org-1",
			},
			ack: vi.fn(),
			retry: vi.fn(),
		};
		const consumer = new SubscriptionPolicyRefreshConsumer(
			policyRefreshService as never,
		);

		await consumer.handleMessage(message as never);

		expect(message.retry).toHaveBeenCalledOnce();
		expect(message.ack).not.toHaveBeenCalled();
	});
});
