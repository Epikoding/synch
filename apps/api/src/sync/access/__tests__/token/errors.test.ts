import { describe, expect, it } from "vitest";
import { HTTPException } from "hono/http-exception";

import { signSyncToken, verifySyncToken } from "../../token";
import {
	claims,
	rawJwt,
	SECRET,
	SYNC_TOKEN_AUDIENCE,
	SYNC_TOKEN_ISSUER,
} from "./helpers";

describe("sync token errors", () => {
	it("rejects an expired token", async () => {
		const token = await signSyncToken(claims({ exp: Math.floor(Date.now() / 1000) - 1 }), SECRET);

		let error: unknown;
		try {
			await verifySyncToken(token, SECRET);
		} catch (thrown) {
			error = thrown;
		}

		expect(error).toBeInstanceOf(HTTPException);
		expect((error as HTTPException).status).toBe(401);
		expect((error as HTTPException).message).toBe("sync token expired");
		await expect((error as HTTPException).getResponse().json()).resolves.toEqual({
			error: "unauthorized",
			message: "sync token expired",
		});
	});

	it("rejects a malformed token", async () => {
		let error: unknown;
		try {
			await verifySyncToken("not-a-jwt", SECRET);
		} catch (thrown) {
			error = thrown;
		}

		expect(error).toBeInstanceOf(HTTPException);
		expect((error as HTTPException).status).toBe(401);
		expect((error as HTTPException).message).toBe("invalid sync token");
		await expect((error as HTTPException).getResponse().json()).resolves.toEqual({
			error: "unauthorized",
			message: "invalid sync token",
		});
	});

	it("rejects a token with the wrong issuer", async () => {
		const token = await rawJwt({ ...claims(), iss: "other-issuer" });

		let error: unknown;
		try {
			await verifySyncToken(token, SECRET);
		} catch (thrown) {
			error = thrown;
		}

		expect(error).toBeInstanceOf(HTTPException);
		expect((error as HTTPException).status).toBe(401);
		expect((error as HTTPException).message).toBe("invalid sync token");
	});

	it("rejects a token with missing sync claims", async () => {
		const now = Math.floor(Date.now() / 1000);
		const token = await rawJwt({
			sub: "user-1",
			scope: "vault:sync",
			iat: now,
			exp: now + 60,
			iss: SYNC_TOKEN_ISSUER,
			aud: SYNC_TOKEN_AUDIENCE,
		});

		let error: unknown;
		try {
			await verifySyncToken(token, SECRET);
		} catch (thrown) {
			error = thrown;
		}

		expect(error).toBeInstanceOf(HTTPException);
		expect((error as HTTPException).status).toBe(401);
		expect((error as HTTPException).message).toBe("invalid sync token claims");
	});
});
