CREATE TABLE `blobs` (
	`blob_id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`last_uploaded_at` integer NOT NULL,
	`delete_after` integer
);
--> statement-breakpoint
CREATE INDEX `idx_blobs_state_delete_after` ON `blobs` (`state`,`delete_after`);--> statement-breakpoint
CREATE TABLE `commits` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mutation_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`revision` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_commits_mutation_id` ON `commits` (`mutation_id`);--> statement-breakpoint
CREATE TABLE `coordinator_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`vault_id` text NOT NULL,
	`current_cursor` integer DEFAULT 0 NOT NULL,
	`storage_used_bytes` integer DEFAULT 0 NOT NULL,
	`storage_limit_bytes` integer DEFAULT 50000000 NOT NULL,
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
CREATE TABLE `entries` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`blob_id` text,
	`encrypted_metadata` text NOT NULL,
	`deleted` integer DEFAULT 0 NOT NULL,
	`updated_seq` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by_user_id` text NOT NULL,
	`updated_by_local_vault_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_entries_updated_seq_entry_id` ON `entries` (`updated_seq`,`entry_id`);--> statement-breakpoint
CREATE INDEX `idx_entries_blob_id` ON `entries` (`blob_id`);--> statement-breakpoint
CREATE TABLE `entry_versions` (
	`version_id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`source_revision` integer NOT NULL,
	`op_type` text NOT NULL,
	`blob_id` text,
	`encrypted_metadata` text NOT NULL,
	`reason` text NOT NULL,
	`bucket_start_ms` integer,
	`captured_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_by_local_vault_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_entry_versions_entry_captured_at` ON `entry_versions` (`entry_id`,`captured_at`,`version_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_entry_versions_auto_bucket` ON `entry_versions` (`entry_id`,`reason`,`bucket_start_ms`);--> statement-breakpoint
CREATE INDEX `idx_entry_versions_expires_at` ON `entry_versions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_entry_versions_blob_expires_at` ON `entry_versions` (`blob_id`,`expires_at`);--> statement-breakpoint
CREATE TABLE `local_vault_cursors` (
	`user_id` text NOT NULL,
	`local_vault_id` text NOT NULL,
	`cursor` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `local_vault_id`)
);
--> statement-breakpoint
CREATE TABLE `maintenance_jobs` (
	`key` text PRIMARY KEY NOT NULL,
	`due_at` integer NOT NULL,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`last_error_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_maintenance_jobs_due_at` ON `maintenance_jobs` (`due_at`);