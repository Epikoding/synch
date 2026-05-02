import { describe, expect, it, vi } from "vitest";

import {
	createCoordinatorService,
	createMockCoordinatorSocketService,
	createMockCoordinatorStateRepository,
	testSocketSession,
	testWebSocket,
} from "./helpers";

describe("coordinator entry-state sync", () => {
	it("lists entry-state delta pages over the websocket control channel", async () => {
		const session = testSocketSession();
		const sender = testWebSocket();
		const socketService = createMockCoordinatorSocketService({
			readSocketSession: vi.fn(() => session),
			sendSocketMessage: vi.fn(),
		});
		const stateRepository = createMockCoordinatorStateRepository({
			currentCursor: vi.fn(() => 10),
			countEntryStates: vi.fn(() => 1),
			listEntryStates: vi.fn(() => [
				{
					entry_id: "entry-1",
					revision: 2,
					blob_id: "blob-1",
					encrypted_metadata: "metadata",
					deleted: false,
					updated_seq: 4,
					updated_at: 123,
				},
			]),
		});
		const service = createCoordinatorService({ stateRepository, socketService });

		await service.handleSocketMessage(
			sender,
			JSON.stringify({
				type: "list_entry_states",
				requestId: "request-entry-states",
				sinceCursor: 2,
				targetCursor: null,
				after: null,
				limit: 100,
			}),
		);

		expect(stateRepository.listEntryStates).toHaveBeenCalledWith(2, 10, null, 101);
		expect(stateRepository.countEntryStates).toHaveBeenCalledWith(2, 10);
		expect(socketService.sendSocketMessage).toHaveBeenCalledWith(sender, {
			type: "entry_states_listed",
			requestId: "request-entry-states",
			targetCursor: 10,
			totalEntries: 1,
			hasMore: false,
			nextAfter: null,
			entries: [
				{
					entryId: "entry-1",
					revision: 2,
					blobId: "blob-1",
					encryptedMetadata: "metadata",
					deleted: false,
					updatedSeq: 4,
					updatedAt: 123,
				},
			],
		});
	});
});
