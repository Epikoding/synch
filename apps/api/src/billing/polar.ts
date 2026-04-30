import { polar, webhooks } from "@polar-sh/better-auth";
import { Polar } from "@polar-sh/sdk";
import type { Subscription } from "@polar-sh/sdk/models/components/subscription";

import { apiError } from "../errors";
import type {
	BillingRepository,
	PolarSubscriptionUpsertInput,
} from "./repository";

export type PolarClientConfig = {
	accessToken?: string;
	productId?: string;
	webhookSecret?: string;
	sandbox?: boolean;
};

export function createPolarAuthPlugin(
	config: PolarClientConfig & { publicBaseUrl: string },
	repository: BillingRepository,
) {
	if (!config.accessToken || !config.productId || !config.webhookSecret) {
		return null;
	}

	const client = createPolarClient(config);
	const handleSubscription = async (payload: {
		data: Subscription;
	}) => {
		const subscription = parsePolarSubscription(payload.data);
		if (subscription) {
			await repository.upsertPolarSubscription(subscription);
		}
	};

	return polar({
		client,
		use: [
			webhooks({
				secret: config.webhookSecret,
				onSubscriptionUpdated: handleSubscription,
			}),
		],
	});
}

export async function createPolarCheckout(
	config: PolarClientConfig & { wwwBaseUrl: string },
	input: {
		organizationId: string;
		userId: string;
		email: string;
	},
): Promise<{ checkoutId: string; url: string }> {
	if (!config.accessToken) {
		throw apiError(500, "billing_not_configured", "POLAR_ACCESS_TOKEN is not configured");
	}
	if (!config.productId) {
		throw apiError(
			500,
			"billing_not_configured",
			"POLAR_STARTER_PRODUCT_ID is not configured",
		);
	}

	try {
		const checkout = await createPolarClient(config).checkouts.create({
			products: [config.productId],
			externalCustomerId: input.userId,
			customerEmail: input.email,
			successUrl: new URL(
				"/billing/success?checkout_id={CHECKOUT_ID}",
				config.wwwBaseUrl,
			).toString(),
			metadata: {
				referenceId: input.organizationId,
				organizationId: input.organizationId,
				userId: input.userId,
				planId: "starter",
			},
		});

		return {
			checkoutId: checkout.id,
			url: checkout.url,
		};
	} catch (error) {
		throw apiError(
			502,
			"polar_checkout_failed",
			error instanceof Error ? error.message : "Polar checkout creation failed",
		);
	}
}

function createPolarClient(config: PolarClientConfig): Polar {
	return new Polar({
		accessToken: config.accessToken,
		server: config.sandbox ? "sandbox" : "production",
	});
}

function parsePolarSubscription(
	subscription: Subscription,
): PolarSubscriptionUpsertInput | null {
	const organizationId = readString(subscription.metadata.referenceId)
		?? readString(subscription.metadata.organizationId);
	if (!organizationId) {
		return null;
	}

	return {
		id: `polar-sub-${subscription.id}`,
		productId: subscription.productId,
		organizationId,
		polarCustomerId: subscription.customerId,
		polarSubscriptionId: subscription.id,
		polarCheckoutId: subscription.checkoutId,
		status: subscription.status,
		periodStart: subscription.currentPeriodStart,
		periodEnd: subscription.currentPeriodEnd,
		cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
	};
}

function readString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}
