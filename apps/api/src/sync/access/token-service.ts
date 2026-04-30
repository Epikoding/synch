import {
	requireSyncToken,
	signSyncToken,
	type SyncTokenClaims,
} from "./token";

export class SyncTokenService {
	constructor(private readonly secret: string) {}

	async requireSyncToken(
		request: Request,
		expectedVaultId?: string,
	): Promise<SyncTokenClaims> {
		return await requireSyncToken(request, this.secret, expectedVaultId);
	}

	async signSyncToken(claims: SyncTokenClaims): Promise<string> {
		return await signSyncToken(claims, this.secret);
	}
}
