import { apiError } from "../errors";
import {
	createPolarCheckout,
	type PolarClientConfig,
} from "./polar";
import type { BillingRepository } from "./repository";
import type { SubscriptionPlanId } from "../subscription/policy";
import { subscriptionGrantsAccess } from "../subscription/policy-service";

export type BillingServiceConfig = PolarClientConfig & {
	publicBaseUrl: string;
	wwwBaseUrl: string;
};

export class BillingService {
	constructor(
		private readonly repository: BillingRepository,
		private readonly config: BillingServiceConfig,
	) {}

	async createStarterCheckout(input: {
		userId: string;
		email: string;
	}): Promise<{ checkoutId: string; url: string }> {
		const organizationId = await this.repository.readDefaultOrganizationIdForUser(
			input.userId,
		);
		if (!organizationId) {
			throw apiError(400, "organization_required", "user has no organization");
		}

		return await createPolarCheckout(this.config, {
			organizationId,
			userId: input.userId,
			email: input.email,
		});
	}

	async readBillingStatus(userId: string): Promise<{
		planId: SubscriptionPlanId;
		active: boolean;
		status: string;
	}> {
		const organizationId = await this.repository.readDefaultOrganizationIdForUser(userId);
		if (!organizationId) {
			throw apiError(400, "organization_required", "user has no organization");
		}

		return await this.readOrganizationBillingStatus(organizationId);
	}

	private async readOrganizationBillingStatus(organizationId: string): Promise<{
		planId: SubscriptionPlanId;
		active: boolean;
		status: string;
	}> {
		const subscriptions =
			await this.repository.readOrganizationSubscriptionStatuses(organizationId);
		const activeSubscription = subscriptions.find(subscriptionGrantsAccess);
		const active = !!activeSubscription;
		const planId: SubscriptionPlanId = active ? "starter" : "free";
		return {
			planId,
			active,
			status: activeSubscription?.status ?? subscriptions[0]?.status ?? "none",
		};
	}
}
