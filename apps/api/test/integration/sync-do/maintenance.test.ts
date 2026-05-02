import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
	initializeCoordinatorState,
	issueSyncToken,
	jsonRequest,
	signUpAndCreateVault,
	uniqueId,
} from "../../helpers/api";
import { uploadBlob } from "./helpers";

describe("sync durable object maintenance integration", () => {
	it("drains due maintenance jobs from the durable object alarm", async () => {
		const primary = await signUpAndCreateVault();
		const stub = env.SYNC_COORDINATOR.getByName(primary.vaultId);
		const token = await issueSyncToken(
			primary.sessionCookie,
			primary.vaultId,
			"local-vault-alarm",
		);
		const blobId = uniqueId("alarm-blob");

		await uploadBlob(primary.vaultId, token.token, blobId, "alarm-body");

		const scheduled = await runInDurableObject(stub, async (_instance, state) => {
			const rows = state.storage.sql
				.exec<{ key: string }>(
					"SELECT key FROM maintenance_jobs ORDER BY key ASC",
				)
				.toArray();
			return {
				keys: rows.map((row) => row.key),
				alarm: await state.storage.getAlarm(),
			};
		});

		expect(scheduled.keys).toEqual(["blob_gc"]);
		expect(scheduled.alarm).toEqual(expect.any(Number));

		await runInDurableObject(stub, async (instance, state) => {
			const expiredAt = Date.now() - 1;
			state.storage.sql.exec(
				"UPDATE blobs SET delete_after = ? WHERE blob_id = ?",
				expiredAt,
				blobId,
			);
			state.storage.sql.exec(
				"UPDATE maintenance_jobs SET due_at = ? WHERE key = 'blob_gc'",
				expiredAt,
			);

			await (instance as unknown as { alarm: () => Promise<void> }).alarm();

			const blob = state.storage.sql
				.exec<{ blob_id: string }>("SELECT blob_id FROM blobs WHERE blob_id = ?", blobId)
				.toArray()[0];
			const remainingJobs = state.storage.sql
				.exec<{ key: string }>("SELECT key FROM maintenance_jobs ORDER BY key ASC")
				.toArray();
			expect(blob).toBeUndefined();
			expect(remainingJobs).toEqual([]);
		});

		const row = await env.DB.prepare(
			"SELECT vault_id, staged_blob_count FROM vault_sync_status WHERE vault_id = ?",
		)
			.bind(primary.vaultId)
			.first<{ vault_id: string; staged_blob_count: number }>();
		expect(row).toEqual({
			vault_id: primary.vaultId,
			staged_blob_count: 0,
		});
	});

	it("garbage-collects an uncommitted staged blob", async () => {
		const primary = await signUpAndCreateVault();
		await initializeCoordinatorState(primary.vaultId);
		const token = await issueSyncToken(primary.sessionCookie, primary.vaultId, "local-vault-blob");
		const stub = env.SYNC_COORDINATOR.getByName(primary.vaultId);
		const blobId = "blob-staged-gc";
		const payload = new TextEncoder().encode("staged blob");

		const uploaded = await jsonRequest(
			`/v1/vaults/${encodeURIComponent(primary.vaultId)}/blobs/${blobId}`,
			{
				method: "PUT",
				headers: {
					authorization: `Bearer ${token.token}`,
					"x-blob-size": String(payload.byteLength),
				},
				body: payload,
			},
		);
		expect(uploaded.response.status).toBe(201);

		await runInDurableObject(stub, async (instance, state) => {
			const expiredAt = Date.now() - 1;
			state.storage.sql.exec(
				"UPDATE blobs SET delete_after = ? WHERE blob_id = ?",
				expiredAt,
				blobId,
			);

			const coordinator = instance as unknown as {
				runGc: () => Promise<void>;
			};
			await coordinator.runGc();
		});

		const missing = await jsonRequest(
			`/v1/vaults/${encodeURIComponent(primary.vaultId)}/blobs/${blobId}`,
			{
				headers: {
					authorization: `Bearer ${token.token}`,
				},
			},
		);
		expect(missing.response.status).toBe(404);

		const blobRow = await runInDurableObject(stub, async (_instance, state) => {
			return state.storage.sql
				.exec<{ blob_id: string }>("SELECT blob_id FROM blobs WHERE blob_id = ?", blobId)
				.toArray()[0];
		});
		expect(blobRow).toBeUndefined();
	});
});
