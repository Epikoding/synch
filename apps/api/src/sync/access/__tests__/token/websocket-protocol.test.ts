import { describe, expect, it } from "vitest";

import {
	selectSyncWebSocketProtocol,
	SYNC_WEBSOCKET_AUTH_PROTOCOL_PREFIX,
	SYNC_WEBSOCKET_PROTOCOL,
} from "../../token";

describe("sync websocket protocol selection", () => {
	it("selects the sync websocket protocol from the request", () => {
		const protocol = selectSyncWebSocketProtocol(
			new Request("http://example.com/v1/vaults/vault-1/socket", {
				headers: {
					"sec-websocket-protocol": `${SYNC_WEBSOCKET_PROTOCOL}, ${SYNC_WEBSOCKET_AUTH_PROTOCOL_PREFIX}token`,
				},
			}),
		);

		expect(protocol).toBe(SYNC_WEBSOCKET_PROTOCOL);
	});

	it("does not echo the auth protocol as the selected websocket protocol", () => {
		const protocol = selectSyncWebSocketProtocol(
			new Request("http://example.com/v1/vaults/vault-1/socket", {
				headers: {
					"sec-websocket-protocol": `${SYNC_WEBSOCKET_AUTH_PROTOCOL_PREFIX}token`,
				},
			}),
		);

		expect(protocol).toBeNull();
	});
});
