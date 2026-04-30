import { errors as joseErrors, jwtVerify, SignJWT } from "jose";
import { z } from "zod";

import { apiError } from "../../errors";

export const SYNC_WEBSOCKET_PROTOCOL = "synch.v1";
export const SYNC_WEBSOCKET_AUTH_PROTOCOL_PREFIX = "synch.auth.";
const SYNC_TOKEN_ALGORITHM = "HS256";
const SYNC_TOKEN_ISSUER = "synch-api";
const SYNC_TOKEN_AUDIENCE = "synch-sync";

export type SyncTokenClaims = {
	sub: string;
	vaultId: string;
	localVaultId: string;
	scope: "vault:sync";
	iat: number;
	exp: number;
};

const syncTokenPayloadSchema = z.object({
	sub: z.string().trim().min(1),
	vaultId: z.string().trim().min(1),
	localVaultId: z.string().trim().min(1),
	scope: z.literal("vault:sync"),
	iat: z.number().int(),
	exp: z.number().int(),
});

export async function requireSyncToken(
	request: Request,
	secret: string,
	expectedVaultId?: string,
): Promise<SyncTokenClaims> {
	const token = readSyncTokenFromRequest(request);

	if (!token) {
		throw apiError(401, "unauthorized", "missing sync token");
	}

	const claims = await verifySyncToken(token, secret);
	if (claims.scope !== "vault:sync") {
		throw apiError(403, "forbidden", "invalid sync scope");
	}

	if (expectedVaultId && claims.vaultId !== expectedVaultId) {
		throw apiError(403, "forbidden", "vault mismatch");
	}

	return claims;
}

export async function signSyncToken(claims: SyncTokenClaims, secret: string): Promise<string> {
	return await new SignJWT({
		vaultId: claims.vaultId,
		localVaultId: claims.localVaultId,
		scope: claims.scope,
	})
		.setProtectedHeader({
			alg: SYNC_TOKEN_ALGORITHM,
			typ: "JWT",
		})
		.setIssuer(SYNC_TOKEN_ISSUER)
		.setAudience(SYNC_TOKEN_AUDIENCE)
		.setSubject(claims.sub)
		.setIssuedAt(claims.iat)
		.setExpirationTime(claims.exp)
		.sign(syncTokenSecretKey(secret));
}

export function selectSyncWebSocketProtocol(request: Request): string | null {
	const protocols = readRequestedWebSocketProtocols(request);
	return protocols.includes(SYNC_WEBSOCKET_PROTOCOL) ? SYNC_WEBSOCKET_PROTOCOL : null;
}

export async function verifySyncToken(token: string, secret: string): Promise<SyncTokenClaims> {
	try {
		const { payload } = await jwtVerify(token, syncTokenSecretKey(secret), {
			algorithms: [SYNC_TOKEN_ALGORITHM],
			issuer: SYNC_TOKEN_ISSUER,
			audience: SYNC_TOKEN_AUDIENCE,
		});
		return syncTokenPayloadSchema.parse(payload);
	} catch (error) {
		if (error instanceof joseErrors.JWTExpired) {
			throw apiError(401, "unauthorized", "sync token expired");
		}
		if (error instanceof z.ZodError) {
			throw apiError(401, "unauthorized", "invalid sync token claims");
		}
		throw apiError(401, "unauthorized", "invalid sync token");
	}
}

function syncTokenSecretKey(secret: string): Uint8Array {
	return new TextEncoder().encode(secret);
}

function readSyncTokenFromRequest(request: Request): string | null {
	const authHeader = request.headers.get("authorization");
	if (authHeader?.startsWith("Bearer ")) {
		return authHeader.slice("Bearer ".length);
	}

	for (const protocol of readRequestedWebSocketProtocols(request)) {
		if (protocol.startsWith(SYNC_WEBSOCKET_AUTH_PROTOCOL_PREFIX)) {
			const token = protocol.slice(SYNC_WEBSOCKET_AUTH_PROTOCOL_PREFIX.length);
			if (token) {
				return token;
			}
		}
	}

	return null;
}

function readRequestedWebSocketProtocols(request: Request): string[] {
	const header = request.headers.get("sec-websocket-protocol");
	if (!header) {
		return [];
	}

	return header
		.split(",")
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
}
