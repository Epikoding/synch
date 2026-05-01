import { vi } from "vitest";

import type { SyncTokenService } from "../../../access/token-service";
import type { BlobRepository } from "../../../blob/repository";
import type { SubscriptionPolicyReader } from "../../../../subscription/policy-service";
import { CoordinatorService } from "../../service";
import type { CoordinatorSocketService } from "../../socket/service";
import type { CoordinatorStateRepository } from "../../state-repository";
import type { SocketSession } from "../../types";

export function testSocketSession(
	overrides: Partial<SocketSession> = {},
): SocketSession {
	return {
		userId: "user-1",
		vaultId: "vault-1",
		localVaultId: "local-vault-1",
		wantsStorageStatus: false,
		...overrides,
	};
}

export function testWebSocket(): WebSocket {
	return {} as WebSocket;
}

export function createMockCoordinatorStateRepository(
	overrides: Record<string, unknown> = {},
): CoordinatorStateRepository {
	return {
		readVersionHistoryRetentionDays: vi.fn(() => 1),
		...overrides,
	} as unknown as CoordinatorStateRepository;
}

export function createMockCoordinatorSocketService(
	overrides: Record<string, unknown> = {},
): CoordinatorSocketService {
	return overrides as unknown as CoordinatorSocketService;
}

export function createCoordinatorService({
	syncTokenService = {} as SyncTokenService,
	stateRepository = createMockCoordinatorStateRepository(),
	socketService = createMockCoordinatorSocketService(),
	blobRepository = {} as BlobRepository,
	subscriptionPolicyService,
}: {
	syncTokenService?: SyncTokenService;
	stateRepository?: CoordinatorStateRepository;
	socketService?: CoordinatorSocketService;
	blobRepository?: BlobRepository;
	subscriptionPolicyService?: SubscriptionPolicyReader;
} = {}): CoordinatorService {
	return new CoordinatorService(
		syncTokenService,
		stateRepository,
		socketService,
		blobRepository,
		null,
		subscriptionPolicyService,
	);
}

export function socketServiceMock(session = testSocketSession()) {
	return createMockCoordinatorSocketService({
		readSocketSession: vi.fn(() => session),
		attachSocketSession: vi.fn(),
		sendSocketMessage: vi.fn(),
		broadcastStorageStatus: vi.fn(),
		broadcastExcept: vi.fn(),
		closeAllSockets: vi.fn(),
	});
}

export function socketStateRepository(_session = testSocketSession()) {
	return createMockCoordinatorStateRepository({
		rememberVaultId: vi.fn(),
		recordLocalVaultCursor: vi.fn(),
		currentCursor: vi.fn(() => 11),
		stageBlob: vi.fn(async () => {}),
		markHealthSummaryDirty: vi.fn(),
		readStorageStatus: vi.fn(() => ({
			storageUsedBytes: 24_300_000,
			storageLimitBytes: 100_000_000,
		})),
		readVersionHistoryRetentionDays: vi.fn(() => 1),
	});
}
