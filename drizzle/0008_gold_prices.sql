CREATE TABLE `gold_prices` (
	`source` text NOT NULL,
	`karat` integer NOT NULL,
	`day` text NOT NULL,
	`value` real NOT NULL,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`source`, `karat`, `day`)
);
