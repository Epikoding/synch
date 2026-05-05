import { Hono } from "hono";
import { z } from "zod";

import type { Auth } from "../auth";
import { apiError } from "../errors";
import { createEnsureAuthenticatedSession } from "../middlewares/authenticated-session";
import {
	SUBSCRIPTION_PLAN_IDS,
	type SubscriptionPlanId,
} from "../subscription/policy";
import type { BillingService } from "./service";

const checkoutRequestSchema = z.object({
	planId: z.enum(SUBSCRIPTION_PLAN_IDS).optional(),
}).strict();

export function registerBillingRoutes(
	app: Hono,
	deps: { auth: Auth; billingService: BillingService },
): void {
	const ensureAuthenticatedSession = createEnsureAuthenticatedSession(deps.auth);

	app.post("/v1/billing/checkout", ensureAuthenticatedSession, async (c) => {
		const user = c.var.user;
		const { planId } = await readCheckoutRequestPlanId(c.req.raw);
		const checkout = await deps.billingService.createCheckout({
			userId: user.id,
			email: user.email,
			planId,
		});

		return c.json(checkout);
	});

	app.get("/v1/billing/status", ensureAuthenticatedSession, async (c) => {
		const user = c.var.user;
		const status = await deps.billingService.readBillingStatus(user.id);

		return c.json(status);
	});
}

async function readCheckoutRequestPlanId(request: Request): Promise<{
	planId: SubscriptionPlanId;
}> {
	if (!request.headers.get("content-type")) {
		return { planId: "starter" };
	}

	let json: unknown;
	try {
		json = await request.json();
	} catch {
		throw apiError(400, "bad_request", "invalid checkout request");
	}

	const parsed = checkoutRequestSchema.safeParse(json);
	if (!parsed.success) {
		throw apiError(400, "bad_request", "invalid checkout request");
	}

	return { planId: parsed.data.planId ?? "starter" };
}
