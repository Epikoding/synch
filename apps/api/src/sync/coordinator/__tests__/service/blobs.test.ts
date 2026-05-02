import { describe, expect, it, vi } from "vitest";

import type { SyncTokenService } from "../../../access/token-service";
import type { BlobRepository } from "../../../blob/repository";
import {
	createCoordinatorService,
	createMockCoordinatorStateRepository,
} from "./helpers";

describe("coordinator blob lifecycle", () => {
	it("skips explicit blob deletion when the blob is still referenced", async () => {
		const syncTokenService = {
			requireSyncToken: vi.fn(async () => ({
				sub: "user-1",
				vaultId: "vault-1",
				localVaultId: "local-vault-1",
				scope: "vault:sync" as const,
				iat: 100,
				exp: 200,
			})),
		} as unknown as SyncTokenService;
		const stateRepository = createMockCoordinatorStateRepository({
			readBlob: vi.fn(() => ({
				blob_id: "blob-1",
				state: "live",
				size_bytes: 42,
				created_at: 1,
				last_uploaded_at: 1,
				delete_after: null,
			})),
			isBlobPinned: vi.fn(() => true),
		});
		const blobRepository = {
			delete: vi.fn(async () => undefined),
		} as unknown as BlobRepository;
		const service = createCoordinatorService({
			syncTokenService,
			stateRepository,
			blobRepository,
		});

		await service.deleteBlob(new Request("http://example.com"), "vault-1", "blob-1");

		expect(syncTokenService.requireSyncToken).toHaveBeenCalledWith(
			expect.any(Request),
			"vault-1",
		);
		expect(stateRepository.readBlob).toHaveBeenCalledWith("blob-1");
		expect(stateRepository.isBlobPinned).toHaveBeenCalledWith("blob-1", false);
		expect(blobRepository.delete).not.toHaveBeenCalled();
	});
});
