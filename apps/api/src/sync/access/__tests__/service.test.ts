import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
	env: {
		DB: {},
		BETTER_AUTH_URL: "https://example.com",
		BETTER_AUTH_SECRET: "test-secret",
	},
}));

import type { VaultService } from "../../../vault/service";
import { SyncService } from "../service";
import type { SyncTokenService } from "../token-service";

describe("SyncService", () => {
	it("rejects issuing a token for a vault the caller cannot access", async () => {
		const vaultService = {
			userCanAccessVault: vi.fn(async () => false),
		} as unknown as VaultService;
		const syncTokenService = {
			signSyncToken: vi.fn(async () => "token"),
		} as unknown as SyncTokenService;
		const service = new SyncService(vaultService, syncTokenService);

		await expect(
			service.issueSyncToken(
				{ userId: "user-1" },
				{
					vaultId: "vault-foreign",
					localVaultId: "local-vault-1",
				},
			),
		).rejects.toMatchObject({
			status: 403,
		});
		expect(syncTokenService.signSyncToken).not.toHaveBeenCalled();
	});
});
