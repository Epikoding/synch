import { expect } from "vitest";

export function expectDeviceVerificationUrl(value: string | undefined): URL {
	expect(value).toBeTruthy();
	const url = new URL(value ?? "");
	const apiBaseUrl = new URL(process.env.BETTER_AUTH_URL ?? "");

	expect(url.origin).toBe(apiBaseUrl.origin);
	expect(url.pathname).toBe("/device");

	return url;
}

export function apiAuthPageHeaders(): Record<string, string> {
	const origin = new URL(process.env.BETTER_AUTH_URL ?? "").origin;
	return {
		origin,
		referer: `${origin}/device`,
	};
}
