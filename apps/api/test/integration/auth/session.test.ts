import { describe, expect, it } from "vitest";

import {
	jsonRequest,
	signUpAccount,
	signUpAndCreateVault,
} from "../../helpers/api";

describe("auth session integration", () => {
	it("creates a session at sign-up and clears it at sign-out", async () => {
		const account = await signUpAccount();

		const session = await jsonRequest<{
			session: { activeOrganizationId?: string | null };
			user: { email: string };
		}>("/api/auth/get-session", {
			headers: {
				cookie: account.sessionCookie,
			},
		});
		expect(session.response.status).toBe(200);
		expect(session.json?.user?.email).toBe(account.email);
		expect(session.json?.session?.activeOrganizationId).toBeTruthy();

		const organizations = await jsonRequest<Array<{ id: string; slug: string }>>(
			"/api/auth/organization/list",
			{
				headers: {
					cookie: account.sessionCookie,
				},
			},
		);
		expect(organizations.response.status).toBe(200);
		expect(organizations.json).toHaveLength(1);
		expect(organizations.json?.[0]?.id).toBe(session.json?.session?.activeOrganizationId);

		const signOut = await jsonRequest("/api/auth/sign-out", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				cookie: account.sessionCookie,
			},
			body: JSON.stringify({}),
		});
		expect(signOut.response.status).toBe(200);

		const sessionAfterSignOut = await jsonRequest("/api/auth/get-session", {
			headers: {
				cookie: account.sessionCookie,
			},
		});
		expect(sessionAfterSignOut.response.status).toBe(200);
		expect(sessionAfterSignOut.json).toBeNull();
	});

	it("uses the bearer session when a conflicting browser cookie is also present", async () => {
		const cookieAccount = await signUpAccount({
			email: `cookie-${crypto.randomUUID()}@example.com`,
		});
		const bearerAccount = await signUpAccount({
			email: `bearer-${crypto.randomUUID()}@example.com`,
		});

		const session = await jsonRequest<{
			user: { email: string };
		}>("/api/auth/get-session", {
			headers: {
				authorization: `Bearer ${sessionCookieValue(bearerAccount.sessionCookie)}`,
				cookie: cookieAccount.sessionCookie,
			},
		});

		expect(session.response.status).toBe(200);
		expect(session.json?.user?.email).toBe(bearerAccount.email);
	});

	it("issues sync tokens for the bearer session when a conflicting browser cookie is present", async () => {
		const cookieAccount = await signUpAndCreateVault();
		const bearerAccount = await signUpAndCreateVault();

		const issued = await jsonRequest<{
			token: string;
			vaultId: string;
			syncFormatVersion: number;
		}>("/v1/sync/token", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${sessionCookieValue(bearerAccount.sessionCookie)}`,
				cookie: cookieAccount.sessionCookie,
			},
			body: JSON.stringify({
				vaultId: bearerAccount.vaultId,
				localVaultId: "mobile-vault",
			}),
		});

		expect(issued.response.status, issued.text).toBe(200);
		expect(issued.json?.token).toBeTruthy();
		expect(issued.json?.vaultId).toBe(bearerAccount.vaultId);
		expect(issued.json?.syncFormatVersion).toBe(2);
	});
});

function sessionCookieValue(cookie: string): string {
	const value = cookie.split("=", 2)[1]?.trim();
	if (!value) {
		throw new Error("session cookie is missing a value");
	}
	return value;
}
