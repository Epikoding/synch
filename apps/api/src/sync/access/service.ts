import { apiError } from "../../errors";
import type { VaultService } from "../../vault/service";
import type { SyncTokenClaims } from "./token";
import { SyncTokenService } from "./token-service";

const DEFAULT_SYNC_TOKEN_TTL_SECONDS = 120;

export type SyncTokenIssueResponse = {
	token: string;
	expiresAt: number;
	vaultId: string;
	localVaultId: string;
	syncFormatVersion: number;
};

export class SyncService {
	private readonly syncTokenTtlSeconds: number;

	constructor(
		private readonly vaultService: VaultService,
		private readonly syncTokenService: SyncTokenService,
		syncTokenTtlSeconds = DEFAULT_SYNC_TOKEN_TTL_SECONDS,
	) {
		this.syncTokenTtlSeconds = syncTokenTtlSeconds;
	}

	async issueSyncToken(
		session: { userId: string },
		input: { vaultId: string; localVaultId: string },
	): Promise<SyncTokenIssueResponse> {
		const vault = await this.vaultService.getAccessibleVault(session.userId, input.vaultId);
		if (!vault) {
			throw apiError(403, "forbidden", "vault access denied");
		}

		const now = Math.floor(Date.now() / 1000);
		const claims: SyncTokenClaims = {
			sub: session.userId,
			vaultId: input.vaultId,
			localVaultId: input.localVaultId,
			scope: "vault:sync",
			iat: now,
			exp: now + this.syncTokenTtlSeconds,
		};

		const token = await this.syncTokenService.signSyncToken(claims);

		return {
			token,
			expiresAt: claims.exp,
			vaultId: claims.vaultId,
			localVaultId: claims.localVaultId,
			syncFormatVersion: vault.syncFormatVersion,
		};
	}
}
