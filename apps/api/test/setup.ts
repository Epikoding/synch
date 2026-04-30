import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { beforeAll } from "vitest";

declare global {
	// Reuse a single migration promise when Vitest reloads setup files.
	var __synchD1Migration: Promise<void> | undefined;
}

type TestEnv = Env & {
	TEST_MIGRATIONS: D1Migration[];
};

function ensureD1Migrated(): Promise<void> {
	const testEnv = env as TestEnv;
	globalThis.__synchD1Migration ??= applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);

	return globalThis.__synchD1Migration;
}

beforeAll(async () => {
	await ensureD1Migrated();
});
