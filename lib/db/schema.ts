import {
  integer,
  real,
  sqliteTable,
  text,
  index,
} from "drizzle-orm/sqlite-core";

/**
 * One row per market per capture tick.
 * `ts` is stored as unix seconds (cheaper than ISO strings for range queries).
 */
export const marketSnapshots = sqliteTable(
  "market_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ts: integer("ts").notNull(), // unix seconds
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

    bidDepth: real("bid_depth"), // asset units
    askDepth: real("ask_depth"),
    bidDepthFiat: real("bid_depth_fiat"),
    askDepthFiat: real("ask_depth_fiat"),
  },
  (t) => [
    index("idx_market_ts").on(t.asset, t.fiat, t.ts),
    index("idx_market_recent").on(t.ts),
  ],
);

/**
 * One row per (merchant × market × capture). Captures what a merchant was
 * doing at a point in time — used for churn, reliability and anomaly
 * detection over longer windows.
 */
export const merchantSnapshots = sqliteTable(
  "merchant_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ts: integer("ts").notNull(),
    asset: text("asset").notNull(),
    fiat: text("fiat").notNull(),

    merchantId: text("merchant_id").notNull(),
    merchantName: text("merchant_name").notNull(),
    isMerchant: integer("is_merchant", { mode: "boolean" }),
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
