import { describe, expect, it } from "vitest";

import { signSyncToken, verifySyncToken } from "../../token";
import { claims, SECRET } from "./helpers";

describe("sync token signing", () => {
	it("signs and verifies a token", async () => {
		const token = await signSyncToken(claims(), SECRET);
		const verified = await verifySyncToken(token, SECRET);

		expect(verified.vaultId).toBe("vault-1");
		expect(verified.localVaultId).toBe("local-vault-1");
	});
});
