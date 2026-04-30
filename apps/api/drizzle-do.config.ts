import { defineConfig } from "drizzle-kit";

export default defineConfig({
	dialect: "sqlite",
	driver: "durable-sqlite",
	schema: "./src/db/do/index.ts",
	out: "./drizzle-do",
	strict: true,
	verbose: true,
});
