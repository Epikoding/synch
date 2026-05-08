import { apiError } from "../errors";
import {
	createPolarCheckout,
	createPolarCustomerPortalSession,
	type PolarClientConfig,
} from "./polar";
import type { BillingRepository } from "./repository";
import type {
	PaidSubscriptionPlanId,
	SubscriptionBillingInterval,
	SubscriptionPlanId,
	SubscriptionProductIdsByPlanId,
} from "../subscription/policy";
import { subscriptionAccess } from "../subscription/policy-service";

export type BillingServiceConfig = PolarClientConfig & {
	productIdsByPlanId?: SubscriptionProductIdsByPlanId;
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
		billingInterval?: SubscriptionBillingInterval;
	}): Promise<{ checkoutId: string; url: string }> {
		const billingInterval = input.billingInterval ?? "monthly";
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
		const productId =
			this.config.productIdsByPlanId?.[planId]?.[billingInterval];
		if (!productId) {
			throw new Error(
				`Polar product ID is not configured for ${planId} ${billingInterval}`,
			);
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
			billingInterval,
			productId,
			organizationId,
			userId: input.userId,
			email: input.email,
		});
	}

	async readBillingStatus(userId: string): Promise<{
		planId: SubscriptionPlanId;
		billingInterval: SubscriptionBillingInterval | null;
		active: boolean;
		status: string;
		cancelAtPeriodEnd: boolean;
		periodEnd: string | null;
	}> {
		const organizationId = await this.repository.readDefaultOrganizationIdForUser(userId);
		if (!organizationId) {
			throw apiError(400, "organization_required", "user has no organization");
		}

		return await this.readOrganizationBillingStatus(organizationId);
	}

	async createCustomerPortalSession(
		userId: string,
		returnPath = "/billing",
	): Promise<{ url: string }> {
		const organizationId = await this.repository.readDefaultOrganizationIdForUser(userId);
		if (!organizationId) {
			throw apiError(400, "organization_required", "user has no organization");
		}

		const polarCustomerId =
			await this.repository.readOrganizationPolarCustomerId(organizationId);
		if (!polarCustomerId) {
			throw apiError(
				404,
				"billing_customer_not_found",
				"billing customer was not found",
			);
		}

		return await createPolarCustomerPortalSession(this.config, {
			polarCustomerId,
			returnUrl: new URL(returnPath, this.config.wwwBaseUrl).toString(),
		});
	}

	private async readOrganizationBillingStatus(organizationId: string): Promise<{
		planId: SubscriptionPlanId;
		billingInterval: SubscriptionBillingInterval | null;
		active: boolean;
		status: string;
		cancelAtPeriodEnd: boolean;
		periodEnd: string | null;
	}> {
		const subscriptions =
			await this.repository.readOrganizationSubscriptionStatuses(organizationId);
		const activeSubscription = subscriptions
			.map((subscription) => ({
				subscription,
				access: subscriptionAccess(subscription, {
					productIdsByPlanId: this.config.productIdsByPlanId,
				}),
			}))
			.find(({ access }) => access !== null);
		const active = activeSubscription !== undefined;
		const planId: SubscriptionPlanId = activeSubscription?.access?.planId ?? "free";
		return {
			planId,
			billingInterval: activeSubscription?.access?.billingInterval ?? null,
			active,
			status:
				activeSubscription?.subscription.status ?? subscriptions[0]?.status ?? "none",
			cancelAtPeriodEnd:
				activeSubscription?.subscription.cancelAtPeriodEnd
				?? subscriptions[0]?.cancelAtPeriodEnd
				?? false,
			periodEnd:
				(activeSubscription?.subscription.periodEnd ?? subscriptions[0]?.periodEnd)
					?.toISOString() ?? null,
		};
	}
}
