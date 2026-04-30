import { Hono } from "hono";

import type { Auth } from "../auth";
import { createEnsureAuthenticatedSession } from "../middlewares/authenticated-session";
import type { BillingService } from "./service";

export function registerBillingRoutes(
	app: Hono,
	deps: { auth: Auth; billingService: BillingService },
): void {
	const ensureAuthenticatedSession = createEnsureAuthenticatedSession(deps.auth);

	app.post("/v1/billing/checkout", ensureAuthenticatedSession, async (c) => {
		const user = c.var.user;
		const checkout = await deps.billingService.createStarterCheckout({
			userId: user.id,
			email: user.email,
		});

		return c.json(checkout);
	});

	app.get("/v1/billing/status", ensureAuthenticatedSession, async (c) => {
		const user = c.var.user;
		const status = await deps.billingService.readBillingStatus(user.id);

		return c.json(status);
	});
}
