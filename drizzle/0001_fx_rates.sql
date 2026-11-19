CREATE TABLE `fx_rates` (
	`source` text NOT NULL,
	`currency` text NOT NULL,
	`rate_type` text NOT NULL,
	`value` real NOT NULL,
	`as_of` text NOT NULL,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`source`, `currency`, `rate_type`, `as_of`)
);
--> statement-breakpoint
CREATE INDEX `ix_fx_cur_type_day` ON `fx_rates` (`currency`,`rate_type`,`as_of`);--> statement-breakpoint
CREATE INDEX `ix_fx_day` ON `fx_rates` (`as_of`);