import { createMiddleware } from "hono/factory";

import { getSession, type Auth } from "../auth";
import { apiError } from "../errors";
import { User } from "better-auth/types";

export type AuthenticatedSessionVariables = {
	user: User;
};

export function createEnsureAuthenticatedSession(auth: Auth) {
	return createMiddleware<{
		Variables: AuthenticatedSessionVariables;
	}>(async (c, next) => {
		const data = await getSession(auth, c.req.raw);
		if (!data) {
			throw apiError(401, "unauthorized", "authentication required");
		}
		c.set("user", data.user);
		await next();
	});
}
