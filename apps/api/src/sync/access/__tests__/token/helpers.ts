import { SignJWT } from "jose";

import type { SyncTokenClaims } from "../../token";

export const SECRET = "unit-test-secret";
export const SYNC_TOKEN_ISSUER = "synch-api";
export const SYNC_TOKEN_AUDIENCE = "synch-sync";

export function claims(
	overrides: Partial<SyncTokenClaims> = {},
): SyncTokenClaims {
	const now = Math.floor(Date.now() / 1000);
	return {
		sub: "user-1",
		vaultId: "vault-1",
		localVaultId: "local-vault-1",
		scope: "vault:sync",
		iat: now,
		exp: now + 60,
		...overrides,
	};
}

export async function rawJwt(payload: Record<string, unknown>): Promise<string> {
	return await new SignJWT(payload)
		.setProtectedHeader({ alg: "HS256", typ: "JWT" })
		.sign(new TextEncoder().encode(SECRET));
}
