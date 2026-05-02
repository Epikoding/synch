import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { signUpAndCreateVault } from "../../helpers/api";
import { commitMutation } from "./helpers";

describe("sync durable object health integration", () => {
	it("flushes a compact vault health summary to D1", async () => {
		const primary = await signUpAndCreateVault();
		const stub = env.SYNC_COORDINATOR.getByName(primary.vaultId);
		const session = {
			userId: primary.userId,
			localVaultId: "local-vault-health",
			vaultId: primary.vaultId,
		};

		await commitMutation(stub, session, {
			mutationId: "health-summary-commit",
			entryId: "entry-health",
			op: "upsert",
			baseRevision: 0,
			blobId: null,
			encryptedMetadata: "meta-health",
		});

		await runInDurableObject(stub, async (instance) => {
			const coordinator = instance as unknown as {
				flushHealthSummary: () => Promise<void>;
			};
			await coordinator.flushHealthSummary();
		});

		const row = await env.DB.prepare(
			`
			SELECT
				health_status,
				health_reasons_json,
				current_cursor,
				entry_count,
				active_local_vault_count,
				last_commit_at,
				last_flushed_at
			FROM vault_sync_status
			WHERE vault_id = ?
			`,
		)
			.bind(primary.vaultId)
			.first<{
				health_status: string;
				health_reasons_json: string;
				current_cursor: number;
				entry_count: number;
				active_local_vault_count: number;
				last_commit_at: number | null;
				last_flushed_at: number;
			}>();

		expect(row).toEqual(
			expect.objectContaining({
				health_status: "ok",
				health_reasons_json: "[]",
				current_cursor: 1,
				entry_count: 1,
				active_local_vault_count: 0,
			}),
		);
		expect(row?.last_commit_at).toEqual(expect.any(Number));
		expect(row?.last_flushed_at).toEqual(expect.any(Number));
	});
});
