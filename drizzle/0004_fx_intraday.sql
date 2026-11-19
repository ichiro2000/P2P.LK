CREATE TABLE `fx_intraday` (
	`source` text NOT NULL,
	`pair` text NOT NULL,
	`ts` integer NOT NULL,
	`value` real NOT NULL,
	`prev_close` real,
	PRIMARY KEY(`source`, `pair`, `ts`)
);
--> statement-breakpoint
CREATE INDEX `ix_fx_intraday_pair_ts` ON `fx_intraday` (`pair`,`ts`);