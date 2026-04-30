import { and, asc, eq, isNotNull, isNull, or } from "drizzle-orm";

import type { D1Db } from "../db/client";
import * as schema from "../db/d1";
import type {
	VaultBootstrapRecord,
	VaultKeyEnvelope,
	VaultKeyWrapperInput,
	VaultKeyWrapperRecord,
	VaultRecord,
} from "./types";

export class VaultRepository {
	constructor(private readonly db: D1Db) {}

	async userCanAccessVault(userId: string, vaultId: string): Promise<boolean> {
		const rows = await this.db
			.select({
				vaultId: schema.vaultMembership.vaultId,
			})
			.from(schema.vaultMembership)
			.innerJoin(schema.vault, eq(schema.vault.id, schema.vaultMembership.vaultId))
			.innerJoin(schema.member, eq(schema.member.organizationId, schema.vault.organizationId))
			.where(
				and(
					eq(schema.vaultMembership.vaultId, vaultId),
					eq(schema.vaultMembership.userId, userId),
					eq(schema.vaultMembership.status, "active"),
					eq(schema.member.userId, userId),
					isNull(schema.vault.deletedAt),
				),
			)
			.limit(1);

		return rows.length > 0;
	}

	async userCanManageVault(userId: string, vaultId: string): Promise<boolean> {
		const rows = await this.db
			.select({
				vaultId: schema.vaultMembership.vaultId,
			})
			.from(schema.vaultMembership)
			.innerJoin(schema.vault, eq(schema.vault.id, schema.vaultMembership.vaultId))
			.innerJoin(schema.member, eq(schema.member.organizationId, schema.vault.organizationId))
			.where(
				and(
					eq(schema.vaultMembership.vaultId, vaultId),
					eq(schema.vaultMembership.userId, userId),
					eq(schema.vaultMembership.status, "active"),
					eq(schema.member.userId, userId),
					isNull(schema.vault.deletedAt),
					or(
						eq(schema.vaultMembership.role, "owner"),
						eq(schema.vaultMembership.role, "admin"),
					),
				),
			)
			.limit(1);

		return rows.length > 0;
	}

	async listVaultsForUser(
		userId: string,
		options: { includeDeleting?: boolean } = {},
	): Promise<VaultRecord[]> {
		const deletionFilter = options.includeDeleting
			? undefined
			: isNull(schema.vault.deletedAt);
		const rows = await this.db
			.select({
				id: schema.vault.id,
				organizationId: schema.vault.organizationId,
				name: schema.vault.name,
				activeKeyVersion: schema.vault.activeKeyVersion,
				createdAt: schema.vault.createdAt,
				deletedAt: schema.vault.deletedAt,
				purgeStatus: schema.vault.purgeStatus,
				purgeError: schema.vault.purgeError,
			})
			.from(schema.vault)
			.innerJoin(
				schema.vaultMembership,
				eq(schema.vaultMembership.vaultId, schema.vault.id),
			)
			.innerJoin(schema.member, eq(schema.member.organizationId, schema.vault.organizationId))
			.where(
				and(
					eq(schema.vaultMembership.userId, userId),
					eq(schema.vaultMembership.status, "active"),
					eq(schema.member.userId, userId),
					deletionFilter,
				),
			)
			.orderBy(asc(schema.vault.createdAt));
		return rows.map(toVaultRecord);
	}

	async countVaultsForOrganization(organizationId: string): Promise<number> {
		const rows = await this.db
			.select({
				id: schema.vault.id,
			})
			.from(schema.vault)
			.where(
				and(
					eq(schema.vault.organizationId, organizationId),
					isNull(schema.vault.deletedAt),
				),
			);

		return rows.length;
	}

	async vaultNameExistsForOrganization(
		organizationId: string,
		name: string,
	): Promise<boolean> {
		const rows = await this.db
			.select({
				id: schema.vault.id,
			})
			.from(schema.vault)
			.where(
				and(
					eq(schema.vault.organizationId, organizationId),
					eq(schema.vault.name, name),
					isNull(schema.vault.deletedAt),
				),
			)
			.limit(1);

		return rows.length > 0;
	}

	async createVaultForUser(
		userId: string,
		organizationId: string,
		name: string,
		initialWrapper: VaultKeyWrapperInput,
	): Promise<VaultRecord> {
		const vaultId = crypto.randomUUID();
		const rows = await this.db
			.insert(schema.vault)
			.values({
				id: vaultId,
				organizationId,
				name,
				activeKeyVersion: initialWrapper.envelope.keyVersion,
			})
			.returning();

		const created = rows[0];
		if (!created) {
			throw new Error("vault was not created");
		}

		await this.db.insert(schema.vaultKeyWrapper).values({
			id: crypto.randomUUID(),
			vaultId,
			keyVersion: initialWrapper.envelope.keyVersion,
			kind: initialWrapper.kind,
			userId,
			envelopeJson: initialWrapper.envelope,
		});
		await this.db.insert(schema.vaultMembership).values({
			vaultId,
			userId,
			role: "owner",
			status: "active",
		});

		return toVaultRecord(created);
	}

	async readDefaultOrganizationIdForUser(userId: string): Promise<string | null> {
		const rows = await this.db
			.select({
				organizationId: schema.member.organizationId,
			})
			.from(schema.member)
			.where(eq(schema.member.userId, userId))
			.orderBy(asc(schema.member.createdAt))
			.limit(1);

		return rows[0]?.organizationId ?? null;
	}

	async userCanGrantVaultAccess(userId: string, vaultId: string): Promise<boolean> {
		if (await this.userCanManageVault(userId, vaultId)) {
			return true;
		}

		const rows = await this.db
			.select({
				vaultId: schema.vault.id,
			})
			.from(schema.vault)
			.innerJoin(schema.member, eq(schema.member.organizationId, schema.vault.organizationId))
			.where(
				and(
					eq(schema.vault.id, vaultId),
					eq(schema.member.userId, userId),
					eq(schema.member.role, "owner"),
					isNull(schema.vault.deletedAt),
				),
			)
			.limit(1);

		return rows.length > 0;
	}

	async userIsOrganizationMember(userId: string, organizationId: string): Promise<boolean> {
		const rows = await this.db
			.select({
				userId: schema.member.userId,
			})
			.from(schema.member)
			.where(
				and(
					eq(schema.member.userId, userId),
					eq(schema.member.organizationId, organizationId),
				),
			)
			.limit(1);

		return rows.length > 0;
	}

	async readVaultOrganizationId(vaultId: string): Promise<string | null> {
		const rows = await this.db
			.select({
				organizationId: schema.vault.organizationId,
			})
			.from(schema.vault)
			.where(and(eq(schema.vault.id, vaultId), isNull(schema.vault.deletedAt)))
			.limit(1);

		return rows[0]?.organizationId ?? null;
	}

	async markVaultDeletionQueued(vaultId: string): Promise<void> {
		await this.db
			.update(schema.vault)
			.set({
				deletedAt: new Date(),
				purgeStatus: "queued",
				purgeError: null,
			})
			.where(and(eq(schema.vault.id, vaultId), isNull(schema.vault.deletedAt)));
	}

	async markVaultPurgeRunning(vaultId: string): Promise<void> {
		await this.db
			.update(schema.vault)
			.set({
				purgeStatus: "running",
				purgeError: null,
			})
			.where(and(eq(schema.vault.id, vaultId), isNotNull(schema.vault.deletedAt)));
	}

	async markVaultPurgeFailed(vaultId: string, message: string): Promise<void> {
		await this.db
			.update(schema.vault)
			.set({
				purgeStatus: "failed",
				purgeError: message,
			})
			.where(and(eq(schema.vault.id, vaultId), isNotNull(schema.vault.deletedAt)));
	}

	async markVaultDeletionQueueFailed(vaultId: string, message: string): Promise<void> {
		await this.db
			.update(schema.vault)
			.set({
				deletedAt: null,
				purgeStatus: "failed",
				purgeError: message,
			})
			.where(eq(schema.vault.id, vaultId));
	}

	async hardDeleteVault(vaultId: string): Promise<void> {
		await this.db.delete(schema.vault).where(eq(schema.vault.id, vaultId));
	}

	async addVaultMember(
		vaultId: string,
		userId: string,
		role: "admin" | "member",
		wrapper: VaultKeyWrapperInput,
	): Promise<VaultKeyWrapperRecord> {
		const rows = await this.db
			.insert(schema.vaultKeyWrapper)
			.values({
				id: crypto.randomUUID(),
				vaultId,
				keyVersion: wrapper.envelope.keyVersion,
				kind: wrapper.kind,
				userId,
				envelopeJson: wrapper.envelope,
				revokedAt: null,
			})
			.onConflictDoUpdate({
				target: [
					schema.vaultKeyWrapper.vaultId,
					schema.vaultKeyWrapper.kind,
					schema.vaultKeyWrapper.userId,
				],
				set: {
					keyVersion: wrapper.envelope.keyVersion,
					envelopeJson: wrapper.envelope,
					revokedAt: null,
				},
			})
			.returning();

		const created = rows[0];
		if (!created) {
			throw new Error(`member wrapper for vault ${vaultId} was not written`);
		}

		await this.db
			.insert(schema.vaultMembership)
			.values({
				vaultId,
				userId,
				role,
				status: "active",
				revokedAt: null,
			})
			.onConflictDoUpdate({
				target: [schema.vaultMembership.vaultId, schema.vaultMembership.userId],
				set: {
					role,
					status: "active",
					revokedAt: null,
				},
			});

		return toVaultKeyWrapperRecord(created);
	}

	async readVaultBootstrapForUser(
		userId: string,
		vaultId: string,
	): Promise<VaultBootstrapRecord | null> {
		const vault = await this.readAccessibleVaultForUser(userId, vaultId);
		if (!vault) {
			return null;
		}

		const wrapperRows = await this.db
			.select()
			.from(schema.vaultKeyWrapper)
			.where(
				and(
					eq(schema.vaultKeyWrapper.vaultId, vaultId),
					isNull(schema.vaultKeyWrapper.revokedAt),
					or(
						eq(schema.vaultKeyWrapper.userId, userId),
						isNull(schema.vaultKeyWrapper.userId),
					),
				),
			)
			.orderBy(asc(schema.vaultKeyWrapper.createdAt));

		return {
			vault: toVaultRecord(vault),
			wrappers: wrapperRows.map(toVaultKeyWrapperRecord),
		};
	}

	async upsertPasswordWrapperForUser(
		userId: string,
		vaultId: string,
		envelope: VaultKeyEnvelope,
	): Promise<VaultKeyWrapperRecord> {
		const rows = await this.db
			.insert(schema.vaultKeyWrapper)
			.values({
				id: crypto.randomUUID(),
				vaultId,
				keyVersion: envelope.keyVersion,
				kind: "password",
				userId,
				envelopeJson: envelope,
				revokedAt: null,
			})
			.onConflictDoUpdate({
				target: [
					schema.vaultKeyWrapper.vaultId,
					schema.vaultKeyWrapper.kind,
					schema.vaultKeyWrapper.userId,
				],
				set: {
					keyVersion: envelope.keyVersion,
					envelopeJson: envelope,
					revokedAt: null,
				},
			})
			.returning();

		const wrapper = rows[0];
		if (!wrapper) {
			throw new Error(`password wrapper for vault ${vaultId} was not written`);
		}

		await this.db
			.update(schema.vault)
			.set({
				activeKeyVersion: envelope.keyVersion,
			})
			.where(and(eq(schema.vault.id, vaultId), isNull(schema.vault.deletedAt)));

		return toVaultKeyWrapperRecord(wrapper);
	}

	private async readAccessibleVaultForUser(
		userId: string,
		vaultId: string,
	): Promise<typeof schema.vault.$inferSelect | null> {
		const rows = await this.db
			.select({
				id: schema.vault.id,
				organizationId: schema.vault.organizationId,
				name: schema.vault.name,
				activeKeyVersion: schema.vault.activeKeyVersion,
				createdAt: schema.vault.createdAt,
				deletedAt: schema.vault.deletedAt,
				purgeStatus: schema.vault.purgeStatus,
				purgeError: schema.vault.purgeError,
			})
			.from(schema.vault)
			.innerJoin(
				schema.vaultMembership,
				eq(schema.vaultMembership.vaultId, schema.vault.id),
			)
			.innerJoin(schema.member, eq(schema.member.organizationId, schema.vault.organizationId))
			.where(
				and(
					eq(schema.vault.id, vaultId),
					eq(schema.vaultMembership.userId, userId),
					eq(schema.vaultMembership.status, "active"),
					eq(schema.member.userId, userId),
					isNull(schema.vault.deletedAt),
				),
			)
			.limit(1);

		return rows[0] ?? null;
	}
}

function toVaultRecord(row: typeof schema.vault.$inferSelect): VaultRecord {
	return {
		id: row.id,
		organizationId: row.organizationId,
		name: row.name,
		activeKeyVersion: row.activeKeyVersion,
		createdAt: row.createdAt,
		deletedAt: row.deletedAt,
		purgeStatus: isVaultPurgeStatus(row.purgeStatus) ? row.purgeStatus : null,
		purgeError: row.purgeError,
	};
}

function isVaultPurgeStatus(value: unknown): value is VaultRecord["purgeStatus"] {
	return value === "queued" || value === "running" || value === "failed" || value === null;
}

function toVaultKeyWrapperRecord(
	row: typeof schema.vaultKeyWrapper.$inferSelect,
): VaultKeyWrapperRecord {
	return {
		id: row.id,
		vaultId: row.vaultId,
		keyVersion: row.keyVersion,
		kind: row.kind as VaultKeyWrapperRecord["kind"],
		userId: row.userId,
		envelope: row.envelopeJson,
		createdAt: row.createdAt,
		revokedAt: row.revokedAt,
	};
}
