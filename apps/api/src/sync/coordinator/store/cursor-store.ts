import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";

import * as doSchema from "../../../db/do";

type CursorDb = Pick<
	ReturnType<typeof drizzle<typeof doSchema>>,
	"insert" | "select"
>;

const BETA_STORAGE_LIMIT_BYTES = 1_000_000_000;
const BETA_MAX_FILE_SIZE_BYTES = 10_000_000;
const BETA_VERSION_HISTORY_RETENTION_DAYS = 1;

export class CoordinatorCursorStore {
	constructor(private readonly storage: DurableObjectStorage) {}

	currentCursor(): number {
		return currentCursor(this.getDb());
	}

	ensureVaultState(vaultId: string): void {
		ensureVaultState(this.getDb(), vaultId);
	}

	readVaultId(): string | null {
		const row = this.getDb()
			.select({
				vaultId: doSchema.coordinatorState.vaultId,
			})
			.from(doSchema.coordinatorState)
			.where(eq(doSchema.coordinatorState.id, 1))
			.limit(1)
			.get();
		return row?.vaultId ?? null;
	}

	recordLocalVaultCursor(userId: string, localVaultId: string, cursor: number): void {
		recordLocalVaultCursor(this.getDb(), userId, localVaultId, cursor, Date.now());
	}

	deleteLocalVaultCursor(userId: string, localVaultId: string): void {
		this.getDb()
			.delete(doSchema.localVaultCursors)
			.where(
				and(
					eq(doSchema.localVaultCursors.userId, userId),
					eq(doSchema.localVaultCursors.localVaultId, localVaultId),
				),
			)
			.run();
	}

	recordCommittedLocalVaultCursor(
		db: CursorDb,
		input: {
			userId: string;
			localVaultId: string;
			cursor: number;
			now: number;
		},
	): void {
		recordLocalVaultCursor(
			db,
			input.userId,
			input.localVaultId,
			input.cursor,
			input.now,
		);
	}

	currentCursorInTransaction(db: CursorDb): number {
		return currentCursor(db);
	}

	private getDb() {
		return drizzle(this.storage, { schema: doSchema });
	}
}

function ensureVaultState(db: CursorDb, vaultId: string): void {
	const existing = db
		.select({
			vaultId: doSchema.coordinatorState.vaultId,
		})
		.from(doSchema.coordinatorState)
		.where(eq(doSchema.coordinatorState.id, 1))
		.limit(1)
		.get();
	if (existing) {
		if (existing.vaultId !== vaultId) {
			throw new Error("durable object vault id mismatch");
		}
		return;
	}

	db.insert(doSchema.coordinatorState)
		.values({
			id: 1,
			vaultId,
			currentCursor: 0,
			storageLimitBytes: BETA_STORAGE_LIMIT_BYTES,
			maxFileSizeBytes: BETA_MAX_FILE_SIZE_BYTES,
			versionHistoryRetentionDays: BETA_VERSION_HISTORY_RETENTION_DAYS,
		})
		.run();
}

function currentCursor(db: CursorDb): number {
	const state = db
		.select({
			cursor: doSchema.coordinatorState.currentCursor,
		})
		.from(doSchema.coordinatorState)
		.where(eq(doSchema.coordinatorState.id, 1))
		.limit(1)
		.get();
	if (state) {
		return Number(state.cursor);
	}

	throw new Error("vault sync state is not initialized");
}

function recordLocalVaultCursor(
	db: CursorDb,
	userId: string,
	localVaultId: string,
	cursor: number,
	updatedAt: number,
): void {
	db.insert(doSchema.localVaultCursors)
		.values({
			userId,
			localVaultId,
			cursor,
			updatedAt,
		})
		.onConflictDoUpdate({
			target: [
				doSchema.localVaultCursors.userId,
				doSchema.localVaultCursors.localVaultId,
			],
			set: {
				cursor: sql`max(${doSchema.localVaultCursors.cursor}, ${cursor})`,
				updatedAt,
			},
		})
		.run();
}
