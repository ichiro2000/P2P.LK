import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  real,
  serial,
  text,
} from "drizzle-orm/pg-core";

/**
 * Postgres schema. `ts` is stored as BIGINT unix seconds so queries over
 * large time windows stay integer-only and index-friendly. We could use
 * timestamptz, but bigint-seconds keeps the data layer portable (the ingest
 * tool speaks seconds too) and shaves a few milliseconds on range scans.
 */

export const marketSnapshots = pgTable(
  "market_snapshots",
  {
    id: serial("id").primaryKey(),
    ts: bigint("ts", { mode: "number" }).notNull(),
    asset: text("asset").notNull(),
    fiat: text("fiat").notNull(),

    bestBid: real("best_bid"),
    bestAsk: real("best_ask"),
    mid: real("mid"),
    spread: real("spread"),
    spreadPct: real("spread_pct"),

    medianBid: real("median_bid"),
    medianAsk: real("median_ask"),
    vwapBid: real("vwap_bid"),
    vwapAsk: real("vwap_ask"),

    bidCount: integer("bid_count"),
    askCount: integer("ask_count"),

    bidDepth: real("bid_depth"),
    askDepth: real("ask_depth"),
    bidDepthFiat: real("bid_depth_fiat"),
    askDepthFiat: real("ask_depth_fiat"),
  },
  (t) => [
    index("idx_market_ts").on(t.asset, t.fiat, t.ts),
    index("idx_market_recent").on(t.ts),
  ],
);

export const merchantSnapshots = pgTable(
  "merchant_snapshots",
  {
    id: serial("id").primaryKey(),
    ts: bigint("ts", { mode: "number" }).notNull(),
    asset: text("asset").notNull(),
    fiat: text("fiat").notNull(),

    merchantId: text("merchant_id").notNull(),
    merchantName: text("merchant_name").notNull(),
    isMerchant: boolean("is_merchant"),
    ordersMonth: integer("orders_month"),
    completionRate: real("completion_rate"),
    avgReleaseSec: integer("avg_release_sec"),

    buyAds: integer("buy_ads"),
    sellAds: integer("sell_ads"),
    bestBuyPrice: real("best_buy_price"),
    bestSellPrice: real("best_sell_price"),
    totalAvailableFiat: real("total_available_fiat"),
  },
  (t) => [
    index("idx_merchant_ts").on(t.merchantId, t.asset, t.fiat, t.ts),
    index("idx_merchant_market").on(t.asset, t.fiat, t.ts),
  ],
);

export type MarketSnapshotRow = typeof marketSnapshots.$inferSelect;
export type MarketSnapshotInsert = typeof marketSnapshots.$inferInsert;
export type MerchantSnapshotRow = typeof merchantSnapshots.$inferSelect;
export type MerchantSnapshotInsert = typeof merchantSnapshots.$inferInsert;
