CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `device_code` (
	`id` text PRIMARY KEY NOT NULL,
	`device_code` text NOT NULL,
	`user_code` text NOT NULL,
	`user_id` text,
	`expires_at` integer NOT NULL,
	`status` text NOT NULL,
	`last_polled_at` integer,
	`polling_interval` integer,
	`client_id` text,
	`scope` text
);
--> statement-breakpoint
CREATE TABLE `invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`inviter_id` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inviter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invitation_organizationId_idx` ON `invitation` (`organization_id`);--> statement-breakpoint
CREATE INDEX `invitation_email_idx` ON `invitation` (`email`);--> statement-breakpoint
CREATE TABLE `member` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `member_organizationId_idx` ON `member` (`organization_id`);--> statement-breakpoint
CREATE INDEX `member_userId_idx` ON `member` (`user_id`);--> statement-breakpoint
CREATE TABLE `organization` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`logo` text,
	`polar_customer_id` text,
	`created_at` integer NOT NULL,
	`metadata` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_unique` ON `organization` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `organization_polar_customer_id_unique` ON `organization` (`polar_customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_uidx` ON `organization` (`slug`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`active_organization_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `polar_subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`polar_customer_id` text NOT NULL,
	`polar_subscription_id` text NOT NULL,
	`polar_checkout_id` text,
	`status` text NOT NULL,
	`period_start` integer,
	`period_end` integer,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `polar_subscription_organizationId_idx` ON `polar_subscription` (`organization_id`);--> statement-breakpoint
CREATE INDEX `polar_subscription_customerId_idx` ON `polar_subscription` (`polar_customer_id`);--> statement-breakpoint
CREATE INDEX `polar_subscription_status_idx` ON `polar_subscription` (`status`,`period_end`);--> statement-breakpoint
CREATE UNIQUE INDEX `polar_subscription_polarSubscriptionId_uidx` ON `polar_subscription` (`polar_subscription_id`);--> statement-breakpoint
CREATE TABLE `vault` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`active_key_version` integer NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`deleted_at` integer,
	`purge_status` text,
	`purge_error` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `vault_organizationId_idx` ON `vault` (`organization_id`);--> statement-breakpoint
CREATE INDEX `vault_deletedAt_idx` ON `vault` (`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `vault_organization_name_active_uidx` ON `vault` (`organization_id`,`name`) WHERE "vault"."deleted_at" is null;--> statement-breakpoint
CREATE TABLE `vault_key_wrapper` (
	`id` text PRIMARY KEY NOT NULL,
	`vault_id` text NOT NULL,
	`key_version` integer NOT NULL,
	`kind` text NOT NULL,
	`user_id` text,
	`envelope_json` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`vault_id`) REFERENCES `vault`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `vault_key_wrapper_vaultId_idx` ON `vault_key_wrapper` (`vault_id`);--> statement-breakpoint
CREATE INDEX `vault_key_wrapper_userId_idx` ON `vault_key_wrapper` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `vault_key_wrapper_vault_kind_user_unique` ON `vault_key_wrapper` (`vault_id`,`kind`,`user_id`);--> statement-breakpoint
CREATE TABLE `vault_membership` (
	`vault_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`joined_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`revoked_at` integer,
	PRIMARY KEY(`vault_id`, `user_id`),
	FOREIGN KEY (`vault_id`) REFERENCES `vault`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `vault_membership_userId_status_idx` ON `vault_membership` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `vault_membership_vaultId_status_idx` ON `vault_membership` (`vault_id`,`status`);--> statement-breakpoint
CREATE TABLE `vault_sync_status` (
	`vault_id` text PRIMARY KEY NOT NULL,
	`health_status` text DEFAULT 'unknown' NOT NULL,
	`health_reasons_json` text DEFAULT '[]' NOT NULL,
	`current_cursor` integer DEFAULT 0 NOT NULL,
	`entry_count` integer DEFAULT 0 NOT NULL,
	`live_blob_count` integer DEFAULT 0 NOT NULL,
	`staged_blob_count` integer DEFAULT 0 NOT NULL,
	`pending_delete_blob_count` integer DEFAULT 0 NOT NULL,
	`storage_used_bytes` integer DEFAULT 0 NOT NULL,
	`storage_limit_bytes` integer DEFAULT 0 NOT NULL,
	`active_local_vault_count` integer DEFAULT 0 NOT NULL,
	`websocket_count` integer DEFAULT 0 NOT NULL,
	`oldest_staged_blob_age_ms` integer,
	`oldest_pending_delete_age_ms` integer,
	`last_commit_at` integer,
	`last_gc_at` integer,
	`last_activity_at` integer,
	`last_flushed_at` integer NOT NULL,
	`last_flush_error` text,
	`last_flush_error_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`vault_id`) REFERENCES `vault`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `vault_sync_status_health_idx` ON `vault_sync_status` (`health_status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `vault_sync_status_storage_idx` ON `vault_sync_status` (`storage_used_bytes`,`storage_limit_bytes`);--> statement-breakpoint
CREATE INDEX `vault_sync_status_activity_idx` ON `vault_sync_status` (`last_activity_at`);