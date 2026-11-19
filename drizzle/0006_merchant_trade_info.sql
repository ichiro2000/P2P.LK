CREATE TABLE `merchant_profiles` (
	`exchange` text NOT NULL,
	`merchant_id` text NOT NULL,
	`fetched_at` integer NOT NULL,
	`ok_at` integer,
	`ok` integer NOT NULL,
	`error` text,
	`nick_name` text,
	`completed_orders` integer,
	`completed_buy` integer,
	`completed_sell` integer,
	`orders_30d` integer,
	`buy_30d` integer,
	`sell_30d` integer,
	`completion_30d` real,
	`avg_release_sec` real,
	`avg_pay_sec` real,
	`register_days` integer,
	`first_trade_days` integer,
	`counterparties` integer,
	`deposit_usdt` real,
	`kyc_verified` integer,
	`email_verified` integer,
	`mobile_verified` integer,
	`trade_type` text,
	`user_identity` text,
	`vip_level` integer,
	`last_active_ms` integer,
	`positive` integer,
	`negative` integer,
	`positive_rate` real,
	PRIMARY KEY(`exchange`, `merchant_id`)
);
--> statement-breakpoint
CREATE INDEX `ix_mprof_fetched` ON `merchant_profiles` (`exchange`,`fetched_at`);--> statement-breakpoint
CREATE TABLE `merchant_trade_daily` (
	`exchange` text NOT NULL,
	`merchant_id` text NOT NULL,
	`day` integer NOT NULL,
	`completed_buy` integer,
	`completed_sell` integer,
	`completed_orders` integer,
	`positive` integer,
	`negative` integer,
	`first_ts` integer NOT NULL,
	`last_ts` integer NOT NULL,
	PRIMARY KEY(`exchange`, `merchant_id`, `day`)
);
--> statement-breakpoint
CREATE INDEX `ix_mtd_day` ON `merchant_trade_daily` (`exchange`,`day`);