import { apiError } from "../errors";
import {
	SubscriptionPolicyService,
	type SubscriptionPolicyReader,
} from "../subscription/policy-service";
import type { VaultRepository } from "./repository";
import type { VaultPurgeQueue } from "./purge-queue";
import type {
	VaultBootstrapRecord,
	VaultKeyEnvelope,
	VaultKeyWrapperInput,
	VaultKeyWrapperRecord,
	VaultRecord,
} from "./types";

export class VaultService {
	constructor(
		private readonly vaultRepository: VaultRepository,
		private readonly subscriptionPolicyService: SubscriptionPolicyReader =
			new SubscriptionPolicyService(),
		private readonly vaultPurgeQueue: VaultPurgeQueue | null = null,
	) {}

	async listVaults(
		userId: string,
		options: { includeDeleting?: boolean } = {},
	): Promise<VaultRecord[]> {
		return await this.vaultRepository.listVaultsForUser(userId, options);
	}

	async createVault(
		userId: string,
		name: string,
		initialWrapper: VaultKeyWrapperInput,
	): Promise<VaultRecord> {
		const organizationId = await this.vaultRepository.readDefaultOrganizationIdForUser(userId);
		if (!organizationId) {
			throw apiError(400, "organization_required", "user has no organization");
		}

		const policy =
			await this.subscriptionPolicyService.readOrganizationPolicy(organizationId);
		const existingVaultCount =
			await this.vaultRepository.countVaultsForOrganization(organizationId);
		if (
			policy.limits.syncedVaults > 0 &&
			existingVaultCount >= policy.limits.syncedVaults
		) {
			throw apiError(
				403,
				"vault_limit_exceeded",
				`${policy.name} allows ${policy.limits.syncedVaults} synced vault`,
			);
		}

		if (await this.vaultRepository.vaultNameExistsForOrganization(organizationId, name)) {
			throw apiError(
				409,
				"vault_name_exists",
				"a vault with this name already exists in the organization",
			);
		}

		return await this.vaultRepository.createVaultForUser(
			userId,
			organizationId,
			name,
			initialWrapper,
		);
	}

	async getVaultBootstrap(userId: string, vaultId: string): Promise<VaultBootstrapRecord> {
		const bootstrap = await this.vaultRepository.readVaultBootstrapForUser(userId, vaultId);
		if (!bootstrap) {
			throw apiError(403, "forbidden", "vault access denied");
		}

		return bootstrap;
	}

	async replacePasswordWrapper(
		userId: string,
		vaultId: string,
		envelope: VaultKeyEnvelope,
	): Promise<VaultKeyWrapperRecord> {
		if (!(await this.userCanManageVault(userId, vaultId))) {
			throw apiError(403, "forbidden", "vault access denied");
		}

		return await this.vaultRepository.upsertPasswordWrapperForUser(
			userId,
			vaultId,
			envelope,
		);
	}

	async userCanAccessVault(userId: string, vaultId: string): Promise<boolean> {
		return await this.vaultRepository.userCanAccessVault(userId, vaultId);
	}

	async getAccessibleVault(userId: string, vaultId: string): Promise<VaultRecord | null> {
		return await this.vaultRepository.readAccessibleVaultForUser(userId, vaultId);
	}

	async userCanManageVault(userId: string, vaultId: string): Promise<boolean> {
		return await this.vaultRepository.userCanManageVault(userId, vaultId);
	}

	async deleteVault(
		userId: string,
		vaultId: string,
	): Promise<{ vaultId: string; deletionStatus: "queued" }> {
		if (!(await this.vaultRepository.userCanManageVault(userId, vaultId))) {
			throw apiError(403, "forbidden", "vault access denied");
		}
		if (!this.vaultPurgeQueue) {
			throw new Error("vault purge queue is not configured");
		}

		await this.vaultRepository.markVaultDeletionQueued(vaultId);
		try {
			await this.vaultPurgeQueue.enqueueVaultPurge(vaultId);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await this.vaultRepository.markVaultDeletionQueueFailed(vaultId, message);
			throw error;
		}

		return { vaultId, deletionStatus: "queued" };
	}

	async markVaultPurgeRunning(vaultId: string): Promise<void> {
		await this.vaultRepository.markVaultPurgeRunning(vaultId);
	}

	async markVaultPurgeFailed(vaultId: string, message: string): Promise<void> {
		await this.vaultRepository.markVaultPurgeFailed(vaultId, message);
	}

	async hardDeleteVault(vaultId: string): Promise<void> {
		await this.vaultRepository.hardDeleteVault(vaultId);
	}

	async grantVaultAccess(
		requesterUserId: string,
		vaultId: string,
		input: {
			userId: string;
			role: "admin" | "member";
			memberWrapper: VaultKeyWrapperInput & { kind: "member" };
		},
	): Promise<VaultKeyWrapperRecord> {
		if (!(await this.vaultRepository.userCanGrantVaultAccess(requesterUserId, vaultId))) {
			throw apiError(403, "forbidden", "vault access denied");
		}

		const organizationId = await this.vaultRepository.readVaultOrganizationId(vaultId);
		if (!organizationId) {
			throw apiError(404, "not_found", "vault not found");
		}

		if (!(await this.vaultRepository.userIsOrganizationMember(input.userId, organizationId))) {
			throw apiError(400, "not_organization_member", "user is not a member of the organization");
		}

		return await this.vaultRepository.addVaultMember(
			vaultId,
			input.userId,
			input.role,
			input.memberWrapper,
		);
	}
}
