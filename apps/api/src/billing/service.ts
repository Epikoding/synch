import { apiError } from "../errors";
import {
	createPolarCheckout,
	type PolarClientConfig,
} from "./polar";
import type { BillingRepository } from "./repository";
import type {
	PaidSubscriptionPlanId,
	SubscriptionPlanId,
} from "../subscription/policy";
import { subscriptionAccessPlanId } from "../subscription/policy-service";

export type BillingServiceConfig = PolarClientConfig & {
	productIdsByPlanId?: Partial<Record<PaidSubscriptionPlanId, string>>;
	publicBaseUrl: string;
	wwwBaseUrl: string;
};

const CHECKOUT_PLAN_IDS = ["starter"] as const satisfies readonly PaidSubscriptionPlanId[];
const CHECKOUT_PLAN_ID_SET = new Set<SubscriptionPlanId>(CHECKOUT_PLAN_IDS);

export class BillingService {
	constructor(
		private readonly repository: BillingRepository,
		private readonly config: BillingServiceConfig,
	) {}

	async createCheckout(input: {
		userId: string;
		email: string;
		planId: SubscriptionPlanId;
	}): Promise<{ checkoutId: string; url: string }> {
		const organizationId = await this.repository.readDefaultOrganizationIdForUser(
			input.userId,
		);
		if (!organizationId) {
			throw apiError(400, "organization_required", "user has no organization");
		}

		if (!CHECKOUT_PLAN_ID_SET.has(input.planId)) {
			throw apiError(400, "plan_not_available", "plan is not available for checkout");
		}

		const planId = input.planId as PaidSubscriptionPlanId;
		const productId = this.config.productIdsByPlanId?.[planId];
		if (!productId) {
			throw new Error(`Polar product ID is not configured for ${planId}`);
		}

		const billingStatus = await this.readOrganizationBillingStatus(organizationId);
		if (billingStatus.active) {
			throw apiError(
				409,
				"subscription_already_active",
				"paid subscription is already active",
			);
		}

		return await createPolarCheckout(this.config, {
			planId,
			productId,
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
		const activeSubscription = subscriptions.find(
			(subscription) =>
				subscriptionAccessPlanId(subscription, {
					productIdsByPlanId: this.config.productIdsByPlanId,
				}) !== null,
		);
		const activePlanId = subscriptionAccessPlanId(activeSubscription, {
			productIdsByPlanId: this.config.productIdsByPlanId,
		});
		const active = activePlanId !== null;
		const planId: SubscriptionPlanId = activePlanId ?? "free";
		return {
			planId,
			active,
			status: activeSubscription?.status ?? subscriptions[0]?.status ?? "none",
		};
	}
}
