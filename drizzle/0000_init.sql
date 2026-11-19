CREATE TABLE `ingest_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exchange` text,
	`job` text NOT NULL,
	`ts` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`ok` integer NOT NULL,
	`rows` integer DEFAULT 0 NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `ix_runs_job_ts` ON `ingest_runs` (`job`,`exchange`,`ts`);--> statement-breakpoint
CREATE TABLE `market_hourly` (
	`exchange` text NOT NULL,
	`asset` text NOT NULL,
	`fiat` text NOT NULL,
	`hour_ts` integer NOT NULL,
	`samples` integer NOT NULL,
	`open_mid` real,
	`high_mid` real,
	`low_mid` real,
	`close_mid` real,
	`avg_mid` real,
	`avg_best_bid` real,
	`avg_best_ask` real,
	`avg_spread_pct` real,
	`avg_bid_depth` real,
	`avg_ask_depth` real,
	`avg_bid_depth_fiat` real,
	`avg_ask_depth_fiat` real,
	`avg_bid_count` real,
	`avg_ask_count` real,
	PRIMARY KEY(`exchange`, `asset`, `fiat`, `hour_ts`)
);
--> statement-breakpoint
CREATE TABLE `market_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exchange` text NOT NULL,
	`ts` integer NOT NULL,
	`asset` text NOT NULL,
	`fiat` text NOT NULL,
	`best_bid` real,
	`best_ask` real,
	`mid` real,
	`spread` real,
	`spread_pct` real,
	`median_bid` real,
	`median_ask` real,
	`vwap_bid` real,
	`vwap_ask` real,
	`bid_count` integer,
	`ask_count` integer,
	`bid_depth` real,
	`ask_depth` real,
	`bid_depth_fiat` real,
	`ask_depth_fiat` real
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_market_snap` ON `market_snapshots` (`exchange`,`asset`,`fiat`,`ts`);--> statement-breakpoint
CREATE INDEX `ix_market_snap_ts` ON `market_snapshots` (`ts`);--> statement-breakpoint
CREATE TABLE `merchant_hourly` (
	`exchange` text NOT NULL,
	`merchant_id` text NOT NULL,
	`asset` text NOT NULL,
	`fiat` text NOT NULL,
	`hour_ts` integer NOT NULL,
	`samples` integer NOT NULL,
	`avg_buy_price` real,
	`avg_sell_price` real,
	`max_available_fiat` real,
	`max_buy_ads` integer,
	`max_sell_ads` integer,
	`orders_month` integer,
	`completion_rate` real,
	PRIMARY KEY(`exchange`, `merchant_id`, `asset`, `fiat`, `hour_ts`)
);
--> statement-breakpoint
CREATE INDEX `ix_mhourly_market` ON `merchant_hourly` (`exchange`,`asset`,`fiat`,`hour_ts`);--> statement-breakpoint
CREATE TABLE `merchant_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exchange` text NOT NULL,
	`ts` integer NOT NULL,
	`asset` text NOT NULL,
	`fiat` text NOT NULL,
	`merchant_id` text NOT NULL,
	`merchant_name` text NOT NULL,
	`is_merchant` integer,
	`user_identity` text,
	`user_grade` integer,
	`vip_level` integer,
	`orders_month` integer,
	`completion_rate` real,
	`avg_release_sec` integer,
	`buy_ads` integer,
	`sell_ads` integer,
	`best_buy_price` real,
	`best_sell_price` real,
	`total_available_fiat` real
);
--> statement-breakpoint
CREATE INDEX `ix_msnap_merchant` ON `merchant_snapshots` (`exchange`,`merchant_id`,`ts`);--> statement-breakpoint
CREATE INDEX `ix_msnap_market` ON `merchant_snapshots` (`exchange`,`asset`,`fiat`,`ts`);--> statement-breakpoint
CREATE TABLE `merchants` (
	`exchange` text NOT NULL,
	`merchant_id` text NOT NULL,
	`asset` text NOT NULL,
	`fiat` text NOT NULL,
	`merchant_name` text NOT NULL,
	`is_merchant` integer,
	`user_identity` text,
	`user_grade` integer,
	`vip_level` integer,
	`orders_month` integer,
	`completion_rate` real,
	`avg_release_sec` integer,
	`buy_ads` integer,
	`sell_ads` integer,
	`best_buy_price` real,
	`best_sell_price` real,
	`total_available_fiat` real,
	`first_seen_ts` integer NOT NULL,
	`last_seen_ts` integer NOT NULL,
	PRIMARY KEY(`exchange`, `merchant_id`, `asset`, `fiat`)
);
--> statement-breakpoint
CREATE INDEX `ix_merchants_seen` ON `merchants` (`exchange`,`asset`,`fiat`,`last_seen_ts`);--> statement-breakpoint
CREATE TABLE `suspicious_removal_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exchange` text DEFAULT 'binance' NOT NULL,
	`ts` integer NOT NULL,
	`user_id` text NOT NULL,
	`reason` text NOT NULL,
	`reporter_contact` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewed_ts` integer,
	`review_note` text
);
--> statement-breakpoint
CREATE INDEX `ix_removal_user` ON `suspicious_removal_requests` (`exchange`,`user_id`);--> statement-breakpoint
CREATE INDEX `ix_removal_status_ts` ON `suspicious_removal_requests` (`status`,`ts`);--> statement-breakpoint
CREATE TABLE `suspicious_takers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exchange` text DEFAULT 'binance' NOT NULL,
	`ts` integer NOT NULL,
	`user_id` text NOT NULL,
	`profile_url` text NOT NULL,
	`display_name` text,
	`reason` text NOT NULL,
	`notes` text,
	`reporter` text,
	`status` text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_susp_user` ON `suspicious_takers` (`exchange`,`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `ix_susp_status_ts` ON `suspicious_takers` (`status`,`ts`);--> statement-breakpoint
CREATE TABLE `taker_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exchange` text NOT NULL,
	`user_id` text NOT NULL,
	`ts` integer NOT NULL,
	`nick_name` text,
	`user_identity` text,
	`user_grade` integer,
	`vip_level` integer,
	`orders_month` integer,
	`completion_rate` real,
	`avg_release_sec` integer
);
--> statement-breakpoint
CREATE INDEX `ix_taker_user_ts` ON `taker_snapshots` (`exchange`,`user_id`,`ts`);