import { describe, expect, it } from "vitest";

import { checkObsidianPluginVersion, compareStrictSemver } from "./policy";

describe("compareStrictSemver", () => {
	it("compares strict x.y.z versions", () => {
		expect(compareStrictSemver("1.2.4", "1.2.3")).toBeGreaterThan(0);
		expect(compareStrictSemver("1.2.3", "1.2.3")).toBe(0);
		expect(compareStrictSemver("1.2.3", "1.3.0")).toBeLessThan(0);
	});

	it("rejects malformed versions", () => {
		expect(() => compareStrictSemver("1.2", "1.2.3")).toThrow(
			"Expected strict x.y.z versions.",
		);
		expect(() => compareStrictSemver("1.2.3-beta.1", "1.2.3")).toThrow(
			"Expected strict x.y.z versions.",
		);
		expect(() => compareStrictSemver("01.2.3", "1.2.3")).toThrow(
			"Expected strict x.y.z versions.",
		);
	});
});

describe("checkObsidianPluginVersion", () => {
	it("requires an update below the minimum supported plugin version", () => {
		expect(
			checkObsidianPluginVersion("1.1.9", {
				minVersion: "1.2.0",
			}),
		).toEqual({
			status: "update_required",
			minVersion: "1.2.0",
			message:
				"Synch plugin update is required. Sync has been paused until the plugin is updated.",
		});
	});

	it("allows versions equal to or newer than the minimum supported plugin version", () => {
		expect(
			checkObsidianPluginVersion("1.2.0", {
				minVersion: "1.2.0",
			}).status,
		).toBe("ok");
		expect(
			checkObsidianPluginVersion("1.2.1", {
				minVersion: "1.2.0",
			}).status,
		).toBe("ok");
	});
});
