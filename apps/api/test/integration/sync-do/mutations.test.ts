import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { initializeCoordinatorState, signUpAndCreateVault } from "../../helpers/api";
import type { SyncDoSession, SyncMutation } from "./helpers";

describe("sync durable object mutation integration", () => {
	it("deduplicates an idempotent retry by mutation id even when metadata ciphertext changes", async () => {
		const primary = await signUpAndCreateVault();
		await initializeCoordinatorState(primary.vaultId);
		const stub = env.SYNC_COORDINATOR.getByName(primary.vaultId);

		const retried = await runInDurableObject(stub, async (instance) => {
			const coordinator = instance as unknown as {
				commitMutation: (
					session: SyncDoSession,
					message: {
						type: "commit_mutation";
						requestId: string;
						mutation: SyncMutation;
					},
				) => Promise<{
					message: {
						type: string;
						requestId: string;
						cursor: number;
						revision: number;
					};
					broadcastCursor: number | null;
				}>;
			};

			const session = {
				userId: primary.userId,
				localVaultId: "local-vault-a",
				vaultId: primary.vaultId,
			};

			const first = await coordinator.commitMutation(session, {
				type: "commit_mutation",
				requestId: "request-first",
				mutation: {
					mutationId: "mutation-1",
					entryId: "entry-1",
					op: "upsert",
					baseRevision: 0,
					blobId: null,
					encryptedMetadata: "ciphertext-a",
				},
			});
			const second = await coordinator.commitMutation(session, {
				type: "commit_mutation",
				requestId: "request-second",
				mutation: {
					mutationId: "mutation-1",
					entryId: "entry-1",
					op: "upsert",
					baseRevision: 0,
					blobId: null,
					encryptedMetadata: "ciphertext-b",
				},
			});

			return { first, second };
		});

		expect(retried.first.message.type).toBe("commit_accepted");
		expect(retried.second.message).toEqual({
			...retried.first.message,
			requestId: "request-second",
		});
		expect(retried.second.broadcastCursor).toBeNull();
	});
});
