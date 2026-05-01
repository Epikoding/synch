PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_coordinator_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`vault_id` text NOT NULL,
	`current_cursor` integer DEFAULT 0 NOT NULL,
	`storage_used_bytes` integer DEFAULT 0 NOT NULL,
	`storage_limit_bytes` integer NOT NULL,
	`max_file_size_bytes` integer NOT NULL,
	`version_history_retention_days` integer DEFAULT 1 NOT NULL,
	`health_summary_dirty` integer DEFAULT 0 NOT NULL,
	`last_commit_at` integer,
	`last_activity_at` integer,
	`last_gc_at` integer,
	`last_health_flushed_at` integer,
	`health_flush_retry_count` integer DEFAULT 0 NOT NULL,
	`last_health_flush_error` text,
	`last_health_flush_error_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_coordinator_state`("id", "vault_id", "current_cursor", "storage_used_bytes", "storage_limit_bytes", "max_file_size_bytes", "version_history_retention_days", "health_summary_dirty", "last_commit_at", "last_activity_at", "last_gc_at", "last_health_flushed_at", "health_flush_retry_count", "last_health_flush_error", "last_health_flush_error_at") SELECT "id", "vault_id", "current_cursor", "storage_used_bytes", "storage_limit_bytes", "max_file_size_bytes", 1, "health_summary_dirty", "last_commit_at", "last_activity_at", "last_gc_at", "last_health_flushed_at", "health_flush_retry_count", "last_health_flush_error", "last_health_flush_error_at" FROM `coordinator_state`;--> statement-breakpoint
DROP TABLE `coordinator_state`;--> statement-breakpoint
ALTER TABLE `__new_coordinator_state` RENAME TO `coordinator_state`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
