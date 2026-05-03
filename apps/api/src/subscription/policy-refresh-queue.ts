export type SubscriptionPolicyRefreshMessage = {
	type: "subscription_policy_refresh";
	organizationId: string;
};

export interface SubscriptionPolicyRefreshQueue {
	enqueueOrganizationPolicyRefresh(organizationId: string): Promise<void>;
}

export class CloudflareSubscriptionPolicyRefreshQueue
	implements SubscriptionPolicyRefreshQueue
{
	constructor(private readonly queue: Queue<SubscriptionPolicyRefreshMessage>) {}

	async enqueueOrganizationPolicyRefresh(organizationId: string): Promise<void> {
		await this.queue.send({
			type: "subscription_policy_refresh",
			organizationId,
		});
	}
}
