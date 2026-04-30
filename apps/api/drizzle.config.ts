import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

for (const envFile of [".dev.vars", ".env"]) {
	const envPath = resolve(process.cwd(), envFile);
	if (existsSync(envPath)) {
		loadEnv({ path: envPath, override: false });
	}
}

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const databaseId = process.env.CLOUDFLARE_DATABASE_ID;
const token = process.env.CLOUDFLARE_D1_TOKEN;

export default defineConfig({
	dialect: "sqlite",
	schema: "./src/db/d1/index.ts",
	out: "./drizzle",
	...(accountId && databaseId && token
		? {
				driver: "d1-http" as const,
				dbCredentials: {
					accountId,
					databaseId,
					token,
				},
			}
		: {}),
	strict: true,
	verbose: true,
});
