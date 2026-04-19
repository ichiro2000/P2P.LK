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
    /** Binance's `userIdentity` — e.g. MASS_MERCHANT, BLOCK_MERCHANT. */
    userIdentity: text("user_identity"),
    /** Binance's `userGrade` — merchant-vs-user flag, NOT the tier. Kept
     *  for completeness; prefer `vipLevel` for tier color. */
    userGrade: integer("user_grade"),
    /** Binance's `vipLevel` (1/2/3) — the real tier driver:
     *  1 = Bronze, 2 = Silver, 3 = Gold. */
    vipLevel: integer("vip_level"),
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

/**
 * Community-maintained registry of Binance P2P takers flagged as suspicious
 * (scams, chargebacks, 4th-party settlement, etc). Each row is one report —
 * the same `binanceUserId` can be flagged multiple times with different
 * reasons, so the merchant community builds an evidence trail over time.
 *
 * `binanceUserId` is the `advertiserNo` parsed out of the QR profile URL —
 * it's the stable, canonical identifier across QR images and share links.
 */
export const suspiciousTakers = pgTable(
  "suspicious_takers",
  {
    id: serial("id").primaryKey(),
    ts: bigint("ts", { mode: "number" }).notNull(),
    binanceUserId: text("binance_user_id").notNull(),
    profileUrl: text("profile_url").notNull(),
    displayName: text("display_name"),
    reason: text("reason").notNull(),
    notes: text("notes"),
    reporter: text("reporter"),
    status: text("status").notNull().default("active"),
  },
  (t) => [
    index("idx_suspicious_user").on(t.binanceUserId),
    index("idx_suspicious_ts").on(t.ts),
  ],
);

/**
 * Requests from the public to un-flag a taker. Anyone can file one (no admin
 * token), an admin reviews and either approves or rejects. Approval flips all
 * of that taker's active rows in `suspicious_takers` to `status = 'retracted'`,
 * which drops them out of the registry and the per-user report list in one
 * shot — the existing queries already filter on `status = 'active'`.
 *
 * We keep the row (and the review note / reviewer timestamp) rather than
 * hard-deleting so the audit trail survives and a mistaken approval can be
 * reversed later.
 */
export const suspiciousRemovalRequests = pgTable(
  "suspicious_removal_requests",
  {
    id: serial("id").primaryKey(),
    ts: bigint("ts", { mode: "number" }).notNull(),
    binanceUserId: text("binance_user_id").notNull(),
    reason: text("reason").notNull(),
    reporterContact: text("reporter_contact"),
    /** `pending` | `approved` | `rejected`. */
    status: text("status").notNull().default("pending"),
    reviewedTs: bigint("reviewed_ts", { mode: "number" }),
    reviewNote: text("review_note"),
  },
  (t) => [
    index("idx_removal_user").on(t.binanceUserId),
    index("idx_removal_status_ts").on(t.status, t.ts),
  ],
);

export type MarketSnapshotRow = typeof marketSnapshots.$inferSelect;
export type MarketSnapshotInsert = typeof marketSnapshots.$inferInsert;
export type MerchantSnapshotRow = typeof merchantSnapshots.$inferSelect;
export type MerchantSnapshotInsert = typeof merchantSnapshots.$inferInsert;
export type SuspiciousTakerRow = typeof suspiciousTakers.$inferSelect;
export type SuspiciousTakerInsert = typeof suspiciousTakers.$inferInsert;
export type SuspiciousRemovalRequestRow =
  typeof suspiciousRemovalRequests.$inferSelect;
export type SuspiciousRemovalRequestInsert =
  typeof suspiciousRemovalRequests.$inferInsert;
