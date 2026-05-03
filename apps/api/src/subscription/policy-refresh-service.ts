import type { SubscriptionPlanPolicy } from "./policy";
import type { SubscriptionPolicyReader } from "./policy-service";

type OrganizationVaultReader = {
	listActiveVaultIdsForOrganization(organizationId: string): Promise<string[]>;
};

type VaultPolicyWriter = {
	applyVaultPolicy(
		vaultId: string,
		limits: SubscriptionPlanPolicy["limits"],
	): Promise<Response>;
};

export class SubscriptionPolicyRefreshService {
	constructor(
		private readonly policyReader: SubscriptionPolicyReader,
		private readonly vaultReader: OrganizationVaultReader,
		private readonly vaultPolicyWriter: VaultPolicyWriter,
	) {}

	async refreshOrganizationPolicy(organizationId: string): Promise<void> {
		const policy = await this.policyReader.readOrganizationPolicy(organizationId);
		const vaultIds =
			await this.vaultReader.listActiveVaultIdsForOrganization(organizationId);

		const results = await Promise.allSettled(
			vaultIds.map((vaultId) =>
				this.applyVaultPolicy(vaultId, policy),
			),
		);
		const failures = results.filter((result) => result.status === "rejected");
		if (failures.length > 0) {
			throw new Error(`failed to refresh policy for ${failures.length} vault`);
		}
	}

	private async applyVaultPolicy(
		vaultId: string,
		policy: SubscriptionPlanPolicy,
	): Promise<void> {
		const response = await this.vaultPolicyWriter.applyVaultPolicy(
			vaultId,
			policy.limits,
		);
		if (!response.ok) {
			throw new Error(
				`vault policy refresh failed for ${vaultId}: ${response.status}`,
			);
		}
	}
}
