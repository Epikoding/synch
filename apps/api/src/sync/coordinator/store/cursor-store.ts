import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/durable-sqlite";

import * as doSchema from "../../../db/do";
import { CoordinatorBlobStore } from "./blob-store";

type CursorDb = Pick<ReturnType<typeof drizzle<typeof doSchema>>, "insert" | "select">;

export class CoordinatorCursorStore {
	private readonly blobStore: CoordinatorBlobStore;

	constructor(private readonly storage: DurableObjectStorage) {
		this.blobStore = new CoordinatorBlobStore(storage);
	}

	currentCursor(): number {
		return currentCursor(this.getDb());
	}

	rememberVaultId(vaultId: string): void {
		rememberVaultId(this.getDb(), vaultId);
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

	recordCommittedCursor(
		db: CursorDb,
		input: {
			vaultId: string;
			userId: string;
			localVaultId: string;
			cursor: number;
			now: number;
		},
	): void {
		db.insert(doSchema.coordinatorState)
			.values({
				id: 1,
				vaultId: input.vaultId,
				currentCursor: input.cursor,
				lastCommitAt: input.now,
			})
			.onConflictDoUpdate({
				target: doSchema.coordinatorState.id,
				set: {
					vaultId: input.vaultId,
					currentCursor: input.cursor,
					lastCommitAt: input.now,
				},
			})
			.run();

		recordLocalVaultCursor(
			db,
			input.userId,
			input.localVaultId,
			input.cursor,
			input.now,
		);
	}

	rememberVaultIdInTransaction(db: CursorDb, vaultId: string): void {
		rememberVaultId(db, vaultId);
	}

	currentCursorInTransaction(db: CursorDb): number {
		return currentCursor(db);
	}

	compactSyncedCommits(now: number, activeCursorTtlMs: number, limit: number): number {
		const activeSince = now - activeCursorTtlMs;
		const safeCursorRow = this.storage.sql
			.exec<{ safe_cursor: number | null }>(
				`
				SELECT min(cursor) AS safe_cursor
				FROM local_vault_cursors
				WHERE updated_at >= ?
				`,
				activeSince,
			)
			.toArray()[0];
		const safeCursor = Number(safeCursorRow?.safe_cursor ?? 0);
		if (safeCursor <= 0) {
			return 0;
		}

		const deletedRows = this.storage.sql
			.exec<{ seq: number }>(
				`
				SELECT seq
				FROM commits
				WHERE seq <= ?
				ORDER BY seq ASC
				LIMIT ?
				`,
				safeCursor,
				limit,
			)
			.toArray();
		if (deletedRows.length === 0) {
			return 0;
		}

		const maxDeletedSeq = Math.max(...deletedRows.map((row) => Number(row.seq)));
		this.storage.sql.exec("DELETE FROM commits WHERE seq <= ?", maxDeletedSeq);
		this.blobStore.markUnpinnedBlobsForDeletion(now);
		return deletedRows.length;
	}

	private getDb() {
		return drizzle(this.storage, { schema: doSchema });
	}
}

function rememberVaultId(db: CursorDb, vaultId: string): void {
	db.insert(doSchema.coordinatorState)
		.values({
			id: 1,
			vaultId,
			currentCursor: currentCursor(db),
		})
		.onConflictDoUpdate({
			target: doSchema.coordinatorState.id,
			set: {
				vaultId,
			},
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

	const row = db
		.select({
			cursor: sql<number>`coalesce(max(${doSchema.commits.seq}), 0)`,
		})
		.from(doSchema.commits)
		.get();
	return Number(row?.cursor ?? 0);
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
