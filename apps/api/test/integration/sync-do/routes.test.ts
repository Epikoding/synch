import { describe, expect, it } from "vitest";

import {
	issueSyncToken,
	jsonRequest,
	signUpAndCreateVault,
} from "../../helpers/api";

describe("sync durable object route integration", () => {
	it("rejects a sync token that targets a different vault", async () => {
		const primary = await signUpAndCreateVault();
		const secondary = await signUpAndCreateVault();
		const secondaryToken = await issueSyncToken(
			secondary.sessionCookie,
			secondary.vaultId,
			"local-vault-secondary",
		);

		const denied = await jsonRequest(
			`/v1/vaults/${encodeURIComponent(primary.vaultId)}/socket`,
			{
				headers: {
					authorization: `Bearer ${secondaryToken.token}`,
				},
			},
		);

		expect(denied.response.status).toBe(403);
	});

	it("does not expose sync coordinator control APIs over HTTP", async () => {
		const primary = await signUpAndCreateVault();
		const token = await issueSyncToken(primary.sessionCookie, primary.vaultId, "local-vault-a");

		const changes = await jsonRequest(
			`/v1/vaults/${encodeURIComponent(primary.vaultId)}/changes?since=0`,
			{
				headers: {
					authorization: `Bearer ${token.token}`,
				},
			},
		);
		expect(changes.response.status).toBe(404);

		const ack = await jsonRequest(
			`/v1/vaults/${encodeURIComponent(primary.vaultId)}/cursor/ack`,
			{
				method: "POST",
				headers: {
					authorization: `Bearer ${token.token}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ cursor: 0 }),
			},
		);
		expect(ack.response.status).toBe(404);

		const history = await jsonRequest(
			`/v1/vaults/${encodeURIComponent(primary.vaultId)}/entries/entry-1/history`,
			{
				headers: {
					authorization: `Bearer ${token.token}`,
				},
			},
		);
		expect(history.response.status).toBe(404);

		const restore = await jsonRequest(
			`/v1/vaults/${encodeURIComponent(primary.vaultId)}/entries/entry-1/restore`,
			{
				method: "POST",
				headers: {
					authorization: `Bearer ${token.token}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ versionId: "version-1" }),
			},
		);
		expect(restore.response.status).toBe(404);
	});
});
