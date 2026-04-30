import { Hono } from "hono";

import { normalizeDeviceAuthorizationRequest } from "./device";
import type { Auth } from "./factory";
import { normalizeBearerSessionRequest } from "./session";

export function registerAuthRoutes(app: Hono, auth: Auth): void {
	app.get("/verify-email", (c) => {
		const url = new URL(c.req.url);
		url.pathname = "/api/auth/verify-email";
		return auth.handler(new Request(url.toString(), c.req.raw));
	});
	app.all("/api/auth/*", (c) =>
		auth.handler(normalizeDeviceAuthorizationRequest(normalizeBearerSessionRequest(c.req.raw))),
	);
}
