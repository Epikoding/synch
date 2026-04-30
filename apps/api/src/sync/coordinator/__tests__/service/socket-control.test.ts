import { describe, expect, it, vi } from "vitest";
import { getSubscriptionPlanPolicy } from "../../../../subscription/policy";

import {
	createCoordinatorService,
	createMockCoordinatorStateRepository,
	socketServiceMock,
	socketStateRepository,
	testSocketSession,
	testWebSocket,
} from "./helpers";

describe("coordinator websocket control messages", () => {
	it("does not broadcast cursor advancement back to the socket that committed", async () => {
		const session = testSocketSession();
		const sender = testWebSocket();
		const stateRepository = socketStateRepository(session);
		const socketService = socketServiceMock(session);
		const service = createCoordinatorService({ stateRepository, socketService });
		const commitMutations = vi.spyOn(service, "commitMutations").mockResolvedValue({
			message: {
				type: "commit_mutations_committed",
				requestId: "request-commit",
				cursor: 42,
				results: [
					{
						status: "accepted",
						mutationId: "mutation-1",
						cursor: 42,
						entryId: "entry-1",
						revision: 3,
					},
				],
			},
			broadcastCursor: 42,
		});

		await service.handleSocketMessage(
			sender,
			JSON.stringify({
				type: "commit_mutations",
				requestId: "request-commit",
				mutations: [
					{
						mutationId: "mutation-1",
						entryId: "entry-1",
						op: "delete",
						baseRevision: 2,
						blobId: null,
						encryptedMetadata: "metadata",
					},
				],
			}),
		);

		expect(commitMutations).toHaveBeenCalledWith(session, {
			type: "commit_mutations",
			requestId: "request-commit",
			mutations: [
				{
					mutationId: "mutation-1",
					entryId: "entry-1",
					op: "delete",
					baseRevision: 2,
					blobId: null,
					encryptedMetadata: "metadata",
				},
			],
		});
		expect(socketService.sendSocketMessage).toHaveBeenCalledWith(sender, {
			type: "commit_mutations_committed",
			requestId: "request-commit",
			cursor: 42,
			results: [
				{
					status: "accepted",
					mutationId: "mutation-1",
					cursor: 42,
					entryId: "entry-1",
					revision: 3,
				},
			],
		});
		expect(socketService.broadcastExcept).toHaveBeenCalledWith(sender, {
			type: "cursor_advanced",
			cursor: 42,
		});
		expect(socketService.broadcastStorageStatus).not.toHaveBeenCalled();
	});

	it("restores entry history over the websocket control channel and broadcasts the cursor", async () => {
		const session = testSocketSession();
		const sender = testWebSocket();
		const stateRepository = socketStateRepository(session);
		const socketService = socketServiceMock(session);
		const service = createCoordinatorService({ stateRepository, socketService });
		const restoreEntryVersion = vi.spyOn(service, "restoreEntryVersion").mockResolvedValue({
			message: {
				type: "entry_version_restored",
				requestId: "request-restore",
				entryId: "entry-1",
				restoredFromVersionId: "version-1",
				restoredFromRevision: 1,
				cursor: 42,
				revision: 3,
			},
			broadcastCursor: 42,
		});

		await service.handleSocketMessage(
			sender,
			JSON.stringify({
				type: "restore_entry_version",
				requestId: "request-restore",
				entryId: "entry-1",
				versionId: "version-1",
				baseRevision: 2,
				op: "upsert",
				blobId: "blob-1",
				encryptedMetadata: "ciphertext",
			}),
		);

		expect(restoreEntryVersion).toHaveBeenCalledWith(session, {
			type: "restore_entry_version",
			requestId: "request-restore",
			entryId: "entry-1",
			versionId: "version-1",
			baseRevision: 2,
			op: "upsert",
			blobId: "blob-1",
			encryptedMetadata: "ciphertext",
		});
		expect(socketService.sendSocketMessage).toHaveBeenCalledWith(sender, {
			type: "entry_version_restored",
			requestId: "request-restore",
			entryId: "entry-1",
			restoredFromVersionId: "version-1",
			restoredFromRevision: 1,
			cursor: 42,
			revision: 3,
		});
		expect(socketService.broadcastExcept).toHaveBeenCalledWith(sender, {
			type: "cursor_advanced",
			cursor: 42,
		});
		expect(socketService.broadcastStorageStatus).not.toHaveBeenCalled();
	});

	it("includes policy but not storage status in the hello acknowledgement", async () => {
		const sender = testWebSocket();
		const stateRepository = socketStateRepository();
		const socketService = socketServiceMock();
		const service = createCoordinatorService({
			stateRepository,
			socketService,
			subscriptionPolicyService: {
				readOrganizationPolicy: vi.fn(async () => getSubscriptionPlanPolicy("free")),
				readVaultPolicy: vi.fn(async () => getSubscriptionPlanPolicy("free")),
			},
		});

		await service.handleSocketMessage(
			sender,
			JSON.stringify({
				type: "hello",
				requestId: "request-hello",
				lastKnownCursor: 7,
			}),
		);

		expect(socketService.sendSocketMessage).toHaveBeenCalledWith(sender, {
			type: "hello_ack",
			requestId: "request-hello",
			cursor: 11,
			policy: {
				storageLimitBytes: 100_000_000,
				maxFileSizeBytes: 3_000_000,
			},
			storageStatus: {
				storageUsedBytes: 24_300_000,
				storageLimitBytes: 100_000_000,
			},
		});
	});

	it("acknowledges heartbeat messages", async () => {
		const sender = testWebSocket();
		const stateRepository = socketStateRepository();
		const socketService = socketServiceMock();
		const service = createCoordinatorService({ stateRepository, socketService });

		await service.handleSocketMessage(
			sender,
			JSON.stringify({
				type: "heartbeat",
				requestId: "request-heartbeat",
			}),
		);

		expect(socketService.sendSocketMessage).toHaveBeenCalledWith(sender, {
			type: "heartbeat_ack",
			requestId: "request-heartbeat",
		});
	});

	it("enables storage status updates only after a socket watches them", async () => {
		const session = testSocketSession();
		const sender = testWebSocket();
		const stateRepository = socketStateRepository(session);
		const socketService = socketServiceMock(session);
		const service = createCoordinatorService({ stateRepository, socketService });

		await service.handleSocketMessage(
			sender,
			JSON.stringify({
				type: "watch_storage_status",
			}),
		);

		expect(socketService.attachSocketSession).toHaveBeenCalledWith(sender, {
			...session,
			wantsStorageStatus: true,
		});
		expect(socketService.sendSocketMessage).toHaveBeenCalledWith(sender, {
			type: "storage_status_updated",
			storageStatus: {
				storageUsedBytes: 24_300_000,
				storageLimitBytes: 100_000_000,
			},
		});
	});

	it("disables storage status updates when a socket stops watching them", async () => {
		const session = testSocketSession({ wantsStorageStatus: true });
		const sender = testWebSocket();
		const stateRepository = socketStateRepository(session);
		const socketService = socketServiceMock(session);
		const service = createCoordinatorService({ stateRepository, socketService });

		await service.handleSocketMessage(
			sender,
			JSON.stringify({
				type: "unwatch_storage_status",
			}),
		);

		expect(socketService.attachSocketSession).toHaveBeenCalledWith(sender, {
			...session,
			wantsStorageStatus: false,
		});
		expect(socketService.sendSocketMessage).not.toHaveBeenCalled();
	});

	it("broadcasts storage status after staging a blob", async () => {
		const session = testSocketSession();
		const stateRepository = socketStateRepository(session);
		const socketService = socketServiceMock(session);
		const service = createCoordinatorService({
			stateRepository,
			socketService,
			syncTokenService: {
				requireSyncToken: vi.fn(async () => ({
					sub: session.userId,
					vaultId: session.vaultId,
					localVaultId: session.localVaultId,
					aud: "synch-sync",
					iss: "synch",
					exp: 1,
					iat: 1,
				})),
			} as never,
			subscriptionPolicyService: {
				readOrganizationPolicy: vi.fn(async () => getSubscriptionPlanPolicy("free")),
				readVaultPolicy: vi.fn(async () => getSubscriptionPlanPolicy("free")),
			},
		});

		await service.stageBlob(new Request("http://example.com"), session.vaultId, "blob-1", 100);

		expect(socketService.broadcastStorageStatus).toHaveBeenCalledWith({
			type: "storage_status_updated",
			storageStatus: {
				storageUsedBytes: 24_300_000,
				storageLimitBytes: 100_000_000,
			},
		});
	});

	it("allows blob staging when self-hosted quota limits are unlimited", async () => {
		const session = testSocketSession();
		const stateRepository = socketStateRepository(session);
		const socketService = socketServiceMock(session);
		const service = createCoordinatorService({
			stateRepository,
			socketService,
			syncTokenService: {
				requireSyncToken: vi.fn(async () => ({
					sub: session.userId,
					vaultId: session.vaultId,
					localVaultId: session.localVaultId,
					aud: "synch-sync",
					iss: "synch",
					exp: 1,
					iat: 1,
				})),
			} as never,
			subscriptionPolicyService: {
				readOrganizationPolicy: vi.fn(async () =>
					getSubscriptionPlanPolicy("self_hosted"),
				),
				readVaultPolicy: vi.fn(async () => getSubscriptionPlanPolicy("self_hosted")),
			},
		});

		await service.stageBlob(
			new Request("http://example.com"),
			session.vaultId,
			"blob-unlimited",
			50_000_000,
		);

		expect(stateRepository.stageBlob).toHaveBeenCalledWith(
			"blob-unlimited",
			50_000_000,
			0,
			expect.any(Number),
			expect.any(Number),
		);
		expect(socketService.broadcastStorageStatus).toHaveBeenCalledWith({
			type: "storage_status_updated",
			storageStatus: {
				storageUsedBytes: 24_300_000,
				storageLimitBytes: 0,
			},
		});
	});

	it("broadcasts storage status after blob GC deletes candidates", async () => {
		const stateRepository = socketStateRepository();
		const socketService = socketServiceMock();
		const blobRepository = {
			delete: vi.fn(async () => {}),
		};
		const service = createCoordinatorService({
			stateRepository: {
				...stateRepository,
				readVaultId: vi.fn(() => "vault-1"),
				listBlobsReadyForDeletion: vi.fn(() => [
					{
						blob_id: "blob-1",
						state: "pending_delete",
						size_bytes: 100,
						created_at: 1,
						last_uploaded_at: 1,
						delete_after: 2,
					},
				]),
				deleteBlobIfCollectible: vi.fn(),
				nextBlobGcAt: vi.fn(() => null),
				recordGcCompleted: vi.fn(),
			} as never,
			socketService,
			blobRepository: blobRepository as never,
		});

		await service.runGc("vault-1", { scheduleHealthFlush: false });

		expect(blobRepository.delete).toHaveBeenCalledWith("vault-1/blob-1");
		expect(socketService.broadcastStorageStatus).toHaveBeenCalledWith({
			type: "storage_status_updated",
			storageStatus: {
				storageUsedBytes: 24_300_000,
				storageLimitBytes: 100_000_000,
			},
		});
	});

	it("ignores socket close bookkeeping after a vault purge deletes storage", async () => {
		let service: ReturnType<typeof createCoordinatorService>;
		const stateRepository = createMockCoordinatorStateRepository({
			purgeVaultState: vi.fn(async () => {}),
			markHealthSummaryDirty: vi.fn(),
		});
		const socketService = socketServiceMock();
		vi.mocked(socketService.closeAllSockets).mockImplementation(() => {
			void service.handleSocketClose();
		});
		const blobRepository = {
			deleteByPrefix: vi.fn(async () => {}),
		};
		service = createCoordinatorService({
			stateRepository,
			socketService,
			blobRepository: blobRepository as never,
		});

		await service.purgeVault("vault-1");
		await service.handleSocketClose();

		expect(socketService.closeAllSockets).toHaveBeenCalledWith(4403, "vault deleted");
		expect(blobRepository.deleteByPrefix).toHaveBeenCalledWith("vault-1/");
		expect(stateRepository.purgeVaultState).toHaveBeenCalled();
		expect(stateRepository.markHealthSummaryDirty).not.toHaveBeenCalled();
	});

	it("ignores maintenance alarms after a vault purge deletes storage", async () => {
		const stateRepository = createMockCoordinatorStateRepository({
			purgeVaultState: vi.fn(async () => {}),
		});
		const socketService = socketServiceMock();
		const blobRepository = {
			deleteByPrefix: vi.fn(async () => {}),
		};
		const maintenanceScheduler = {
			drain: vi.fn(async () => {}),
		};
		const service = createCoordinatorService({
			stateRepository,
			socketService,
			blobRepository: blobRepository as never,
		});
		service.setMaintenanceScheduler(maintenanceScheduler as never);

		await service.purgeVault("vault-1");
		await service.handleAlarm();

		expect(maintenanceScheduler.drain).not.toHaveBeenCalled();
	});
});
