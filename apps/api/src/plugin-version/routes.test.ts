import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { registerPluginVersionRoutes } from "./routes";

describe("plugin version routes", () => {
	it("returns ok for a supported Obsidian plugin version", async () => {
		const app = createTestApp();

		const response = await app.request(
			"/v1/obsidian-plugin/version-check?version=0.0.9",
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			status: "ok",
			minVersion: "0.0.9",
		});
	});

	it("returns update_required for an unsupported Obsidian plugin version", async () => {
		const app = createTestApp();

		const response = await app.request(
			"/v1/obsidian-plugin/version-check?version=0.0.7",
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			status: "update_required",
			minVersion: "0.0.9",
		});
	});

	it("rejects malformed versions", async () => {
		const app = createTestApp();

		const response = await app.request(
			"/v1/obsidian-plugin/version-check?version=0.0.8-beta.1",
		);

		expect(response.status).toBe(400);
	});
});

function createTestApp(): Hono {
	const app = new Hono();
	registerPluginVersionRoutes(app);
	return app;
}
