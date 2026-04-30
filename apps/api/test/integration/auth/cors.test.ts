import { describe, expect, it } from "vitest";

import { apiRequest } from "../../helpers/api";

describe("auth CORS integration", () => {
	it("allows CORS requests from the local web dev origin", async () => {
		const allowedOrigin = "http://localhost:4321";

		const response = await apiRequest("/health", {
			headers: {
				origin: allowedOrigin,
			},
		});

		expect(response.status).toBe(200);
		expect(response.headers.get("access-control-allow-origin")).toBe(allowedOrigin);
		expect(response.headers.get("access-control-allow-credentials")).toBe("true");
	});

	it("handles CORS preflight only for the local web dev origin", async () => {
		const allowedOrigin = "http://localhost:4321";

		const allowedResponse = await apiRequest("/api/auth/get-session", {
			method: "OPTIONS",
			headers: {
				origin: allowedOrigin,
				"access-control-request-method": "GET",
			},
		});

		expect(allowedResponse.status).toBe(204);
		expect(allowedResponse.headers.get("access-control-allow-origin")).toBe(allowedOrigin);
		expect(allowedResponse.headers.get("access-control-allow-credentials")).toBe("true");

		const deniedResponse = await apiRequest("/api/auth/get-session", {
			method: "OPTIONS",
			headers: {
				origin: "https://evil.example",
				"access-control-request-method": "GET",
			},
		});

		expect(deniedResponse.status).toBe(204);
		expect(deniedResponse.headers.get("access-control-allow-origin")).toBeNull();
	});
});
