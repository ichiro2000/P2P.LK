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
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_account_user` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `alert_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`rule_id` text NOT NULL,
	`rule_label` text NOT NULL,
	`exchange` text NOT NULL,
	`type` text NOT NULL,
	`observed` real NOT NULL,
	`threshold` real NOT NULL,
	`detail` text,
	`ts` integer NOT NULL,
	`read` integer DEFAULT false NOT NULL,
	`emailed` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_alert_events_user_ts` ON `alert_events` (`user_id`,`ts`);--> statement-breakpoint
CREATE TABLE `alert_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`exchange` text NOT NULL,
	`type` text NOT NULL,
	`asset` text NOT NULL,
	`fiat` text NOT NULL,
	`threshold` real NOT NULL,
	`label` text,
	`enabled` integer DEFAULT true NOT NULL,
	`email` integer DEFAULT true NOT NULL,
	`cooldown_sec` integer DEFAULT 1800 NOT NULL,
	`last_fired_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_alert_rules_user` ON `alert_rules` (`user_id`);--> statement-breakpoint
CREATE INDEX `ix_alert_rules_enabled` ON `alert_rules` (`enabled`,`exchange`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`actor_id` text,
	`actor_email` text,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`detail` text
);
--> statement-breakpoint
CREATE INDEX `ix_audit_ts` ON `audit_log` (`ts`);--> statement-breakpoint
CREATE INDEX `ix_audit_target` ON `audit_log` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `rate_limit` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`count` integer NOT NULL,
	`last_request` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rate_limit_key_unique` ON `rate_limit` (`key`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `ix_session_user` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`merchant_name` text DEFAULT '' NOT NULL,
	`whatsapp` text DEFAULT '' NOT NULL,
	`binance_url` text,
	`bybit_url` text,
	`role` text DEFAULT 'user' NOT NULL,
	`status` text DEFAULT 'pending_email' NOT NULL,
	`review_note` text,
	`reviewed_at` integer,
	`reviewed_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE INDEX `ix_user_status` ON `user` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `user_items` (
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`item_key` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `kind`, `item_key`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_verification_identifier` ON `verification` (`identifier`);