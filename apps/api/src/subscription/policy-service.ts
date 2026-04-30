import { and, desc, eq, isNull } from "drizzle-orm";

import type { D1Db } from "../db/client";
import * as schema from "../db/d1";
import {
	getSubscriptionPlanPolicy,
	type SubscriptionPlanPolicy,
} from "./policy";

export type SubscriptionPolicyReader = {
	readOrganizationPolicy(organizationId: string): Promise<SubscriptionPlanPolicy>;
	readVaultPolicy(vaultId: string): Promise<SubscriptionPlanPolicy>;
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

		if (subscriptions.some(subscriptionGrantsAccess)) {
			return getSubscriptionPlanPolicy("starter");
		}

		return getSubscriptionPlanPolicy("free");
	}

	async readVaultPolicy(vaultId: string): Promise<SubscriptionPlanPolicy> {
		if (this.selfHosted) {
			return getSubscriptionPlanPolicy("self_hosted");
		}
		if (!this.db) {
			return getSubscriptionPlanPolicy("free");
		}

		const rows = await this.db
			.select({
				organizationId: schema.vault.organizationId,
			})
			.from(schema.vault)
			.where(and(eq(schema.vault.id, vaultId), isNull(schema.vault.deletedAt)))
			.limit(1);

		const organizationId = rows[0]?.organizationId;
		if (!organizationId) {
			return getSubscriptionPlanPolicy("free");
		}

		return await this.readOrganizationPolicy(organizationId);
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
