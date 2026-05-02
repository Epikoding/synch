ALTER TABLE `local_vault_cursors` RENAME TO `local_vault_connections`;--> statement-breakpoint
ALTER TABLE `local_vault_connections` RENAME COLUMN "updated_at" TO "last_connected_at";--> statement-breakpoint
ALTER TABLE `local_vault_connections` DROP COLUMN `cursor`;