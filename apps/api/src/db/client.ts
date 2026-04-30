import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import * as schema from "./d1";

export function createDb(database: D1Database) {
	return drizzle(database, {
		schema,
	});
}

export type D1Db = ReturnType<typeof createDb>;

export async function pingDatabase(db: D1Db): Promise<void> {
	await db.run(sql`select 1`);
}
