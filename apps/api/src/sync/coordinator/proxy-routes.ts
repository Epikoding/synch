import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import type { SyncTokenService } from "../access/token-service";
import type { CoordinatorProxyRepository } from "./proxy-repository";
import { Hono } from "hono";

export function registerCoordinatorProxyRoutes(
	app: Hono,
	deps: {
		syncTokenService: SyncTokenService;
		coordinatorProxyRepository: CoordinatorProxyRepository;
	},
): void {
	app.get(
		"/v1/vaults/:vaultId/socket",
		zValidator(
			"param",
			z.object({
				vaultId: z.string().trim().min(1),
			}),
		),
		async (c) => {
			const request = c.req.raw;
			const { vaultId } = c.req.valid("param");

			await deps.syncTokenService.requireSyncToken(request, vaultId);
			return await deps.coordinatorProxyRepository.fetch(vaultId, request);
		},
	);
}
