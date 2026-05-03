import { selectSyncWebSocketProtocol } from "../../access/token";
import type { SyncTokenService } from "../../access/token-service";
import type {
	PolicyUpdatedMessage,
	ServerControlMessage,
	SocketSession,
	StorageStatusUpdatedMessage,
} from "../types";

export class CoordinatorSocketService {
	constructor(private readonly ctx: DurableObjectState) {}

	async openSocket(
		request: Request,
		vaultId: string,
		syncTokenService: SyncTokenService,
		ensureVaultState: (vaultId: string) => Promise<void>,
		scheduleHealthSummaryFlush: (now?: number) => Promise<void>,
	): Promise<Response> {
		const claims = await syncTokenService.requireSyncToken(request, vaultId);
		await ensureVaultState(claims.vaultId);
		const selectedProtocol = selectSyncWebSocketProtocol(request);
		const socketPair = new WebSocketPair();
		const client = socketPair[0];
		const server = socketPair[1];

		this.acceptWebSocket(server);
		const socketSession = {
			userId: claims.sub,
			localVaultId: claims.localVaultId,
			vaultId: claims.vaultId,
			wantsStorageStatus: false,
		} satisfies SocketSession;
		this.attachSocketSession(server, socketSession);
		this.closeSupersededSockets(server, socketSession);
		await scheduleHealthSummaryFlush();

		return new Response(null, {
			status: 101,
			headers: selectedProtocol
				? {
						"Sec-WebSocket-Protocol": selectedProtocol,
					}
				: undefined,
			webSocket: client,
		});
	}

	acceptWebSocket(socket: WebSocket): void {
		this.ctx.acceptWebSocket(socket);
	}

	attachSocketSession(socket: WebSocket, session: SocketSession): void {
		socket.serializeAttachment(session);
	}

	closeSupersededSockets(current: WebSocket, session: SocketSession): void {
		for (const socket of this.ctx.getWebSockets()) {
			if (socket === current) {
				continue;
			}

			const existing = this.readSocketSession(socket);
			if (!existing) {
				continue;
			}

			if (
				existing.userId === session.userId &&
				existing.localVaultId === session.localVaultId
			) {
				this.sendSocketMessage(socket, {
					type: "session_error",
					code: "local_vault_replaced",
					message: "connection replaced by a newer sync session for this local vault",
				});
				socket.close(4409, "superseded by newer connection");
			}
		}
	}

	sendSocketMessage(ws: WebSocket, message: ServerControlMessage): void {
		ws.send(JSON.stringify(message));
	}

	broadcastStorageStatus(message: StorageStatusUpdatedMessage): void {
		const encoded = JSON.stringify(message);
		for (const socket of this.ctx.getWebSockets()) {
			const session = this.readSocketSession(socket);
			if (!session?.wantsStorageStatus) {
				continue;
			}
			socket.send(encoded);
		}
	}

	broadcastPolicyUpdated(message: PolicyUpdatedMessage): void {
		const encoded = JSON.stringify(message);
		for (const socket of this.ctx.getWebSockets()) {
			socket.send(encoded);
		}
	}

	broadcastExcept(excluded: WebSocket, message: ServerControlMessage): void {
		const encoded = JSON.stringify(message);
		for (const socket of this.ctx.getWebSockets()) {
			if (socket === excluded) {
				continue;
			}
			socket.send(encoded);
		}
	}

	closeAllSockets(code: number, reason: string): void {
		for (const socket of this.ctx.getWebSockets()) {
			socket.close(code, reason);
		}
	}

	readSocketSession(ws: WebSocket): SocketSession | null {
		const attachment = ws.deserializeAttachment();
		if (!attachment || typeof attachment !== "object") {
			return null;
		}

		const maybeSession = attachment as Partial<SocketSession>;
		if (
			typeof maybeSession.userId !== "string" ||
			typeof maybeSession.localVaultId !== "string" ||
			typeof maybeSession.vaultId !== "string"
		) {
			return null;
		}

		return {
			userId: maybeSession.userId,
			localVaultId: maybeSession.localVaultId,
			vaultId: maybeSession.vaultId,
			wantsStorageStatus: maybeSession.wantsStorageStatus === true,
		};
	}
}
