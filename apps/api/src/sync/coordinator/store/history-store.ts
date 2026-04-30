import type {
	EntryVersionListRow,
	EntryVersionPageCursor,
	EntryVersionReason,
	EntryVersionRow,
} from "../types";

export class CoordinatorHistoryStore {
	constructor(private readonly storage: DurableObjectStorage) {}

	listEntryVersions(
		entryId: string,
		before: EntryVersionPageCursor | null,
		retentionStart: number,
		limit: number,
	): EntryVersionListRow[] {
		const rows = this.storage.sql
			.exec<{
				version_id: string;
				entry_id: string;
				source_revision: number;
				op_type: string;
				blob_id: string | null;
				encrypted_metadata: string;
				reason: string;
				captured_at: number;
			}>(
				`
				SELECT
					version_id,
					entry_id,
					source_revision,
					op_type,
					blob_id,
					encrypted_metadata,
					reason,
					captured_at
				FROM entry_versions
				WHERE entry_id = ?
					AND captured_at >= ?
					AND (
						? IS NULL
						OR captured_at < ?
						OR (captured_at = ? AND version_id < ?)
					)
				ORDER BY captured_at DESC, version_id DESC
				LIMIT ?
				`,
				entryId,
				retentionStart,
				before?.capturedAt ?? null,
				before?.capturedAt ?? null,
				before?.capturedAt ?? null,
				before?.versionId ?? null,
				limit,
			)
			.toArray();

		return rows.map((row) => ({
			version_id: row.version_id,
			entry_id: row.entry_id,
			source_revision: Number(row.source_revision),
			op_type: row.op_type as EntryVersionRow["op_type"],
			blob_id: row.blob_id,
			encrypted_metadata: row.encrypted_metadata,
			reason: row.reason as EntryVersionReason,
			captured_at: Number(row.captured_at),
		}));
	}

	readEntryVersion(
		entryId: string,
		versionId: string,
		retentionStart: number,
	): EntryVersionRow | null {
		const row = this.storage.sql
			.exec<{
				version_id: string;
				entry_id: string;
				source_revision: number;
				op_type: string;
				blob_id: string | null;
				encrypted_metadata: string;
				reason: string;
				bucket_start_ms: number | null;
				captured_at: number;
				created_by_user_id: string;
				created_by_local_vault_id: string;
			}>(
				`
				SELECT *
				FROM entry_versions
				WHERE entry_id = ?
					AND version_id = ?
					AND captured_at >= ?
				LIMIT 1
				`,
				entryId,
				versionId,
				retentionStart,
			)
			.toArray()[0];

		return row
			? {
					version_id: row.version_id,
					entry_id: row.entry_id,
					source_revision: Number(row.source_revision),
					op_type: row.op_type as EntryVersionRow["op_type"],
					blob_id: row.blob_id,
					encrypted_metadata: row.encrypted_metadata,
					reason: row.reason as EntryVersionReason,
					bucket_start_ms:
						row.bucket_start_ms === null ? null : Number(row.bucket_start_ms),
					captured_at: Number(row.captured_at),
					created_by_user_id: row.created_by_user_id,
					created_by_local_vault_id: row.created_by_local_vault_id,
				}
			: null;
	}
}
