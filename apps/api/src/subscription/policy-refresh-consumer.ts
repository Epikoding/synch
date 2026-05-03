import type { SubscriptionPolicyRefreshMessage } from "./policy-refresh-queue";
import type { SubscriptionPolicyRefreshService } from "./policy-refresh-service";

export class SubscriptionPolicyRefreshConsumer {
	constructor(
		private readonly policyRefreshService: SubscriptionPolicyRefreshService,
	) {}

	async refreshOrganizationPolicy(organizationId: string): Promise<void> {
		await this.policyRefreshService.refreshOrganizationPolicy(organizationId);
	}

	async handleMessage(message: Message<SubscriptionPolicyRefreshMessage>): Promise<void> {
		const body = message.body;
		if (
			body?.type !== "subscription_policy_refresh" ||
			!body.organizationId.trim()
		) {
			message.ack();
			return;
		}

		try {
			await this.refreshOrganizationPolicy(body.organizationId);
			message.ack();
		} catch {
			message.retry();
		}
	}
}
