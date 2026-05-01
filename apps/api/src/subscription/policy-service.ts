import { desc, eq } from "drizzle-orm";

import type { D1Db } from "../db/client";
import * as schema from "../db/d1";
import {
	applySubscriptionPlanLimitOverrides,
	getSubscriptionPlanPolicy,
	type SubscriptionPlanPolicy,
} from "./policy";

export type SubscriptionPolicyReader = {
	readOrganizationPolicy(organizationId: string): Promise<SubscriptionPlanPolicy>;
};

const ACTIVE_ACCESS_STATUSES = new Set(["active", "trialing"]);
const PERIOD_ACCESS_STATUSES = new Set(["canceled", "past_due", "unpaid"]);

export class SubscriptionPolicyService implements SubscriptionPolicyReader {
	constructor(
		private readonly selfHosted = false,
		private readonly db: D1Db | null = null,
	) {}

	async readOrganizationPolicy(organizationId: string): Promise<SubscriptionPlanPolicy> {
		if (this.selfHosted) {
			return getSubscriptionPlanPolicy("self_hosted");
		}
		if (!this.db) {
			return getSubscriptionPlanPolicy("free");
		}

		const subscriptions = await this.db
			.select({
				status: schema.polarSubscription.status,
				periodEnd: schema.polarSubscription.periodEnd,
			})
			.from(schema.polarSubscription)
			.where(eq(schema.polarSubscription.organizationId, organizationId))
			.orderBy(desc(schema.polarSubscription.periodEnd))
			.limit(10);

		const basePolicy = subscriptions.some(subscriptionGrantsAccess)
			? getSubscriptionPlanPolicy("starter")
			: getSubscriptionPlanPolicy("free");

		const organizations = await this.db
			.select({
				syncedVaultsOverride: schema.organization.syncedVaultsOverride,
			})
			.from(schema.organization)
			.where(eq(schema.organization.id, organizationId))
			.limit(1);

		const organization = organizations[0];
		if (!organization) {
			return basePolicy;
		}

		return applySubscriptionPlanLimitOverrides(basePolicy, {
			syncedVaults: organization.syncedVaultsOverride,
		});
	}

}

export function subscriptionGrantsAccess(
	subscription:
		| {
				status: string;
				periodEnd: Date | null;
		  }
		| undefined,
): boolean {
	if (!subscription) {
		return false;
	}
	if (ACTIVE_ACCESS_STATUSES.has(subscription.status)) {
		return !subscription.periodEnd || subscription.periodEnd.getTime() > Date.now();
	}
	if (!PERIOD_ACCESS_STATUSES.has(subscription.status)) {
		return false;
	}

	return !!subscription.periodEnd && subscription.periodEnd.getTime() > Date.now();
}
