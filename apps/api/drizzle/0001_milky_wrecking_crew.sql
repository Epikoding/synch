ALTER TABLE `organization` ADD `synced_vaults_override` integer;--> statement-breakpoint
ALTER TABLE `organization` ADD `storage_limit_bytes_override` integer;--> statement-breakpoint
ALTER TABLE `organization` ADD `max_file_size_bytes_override` integer;--> statement-breakpoint
ALTER TABLE `organization` ADD `version_history_retention_days_override` integer;