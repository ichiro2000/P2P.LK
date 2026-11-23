import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Cloudflare D1 (SQLite) schema.
 *
 * Storage strategy — the old Postgres DB grew ~20 MB/day because every
 * merchant was written every tick forever. Now:
 *
 *   market_snapshots    raw, 1/min/exchange            kept 14 days
 *   market_hourly       OHLC + averages per hour        kept forever
 *   merchants           ONE row per merchant (latest)   kept forever
 *   merchant_snapshots  raw, every 10-min sweep         kept 3 days
 *   merchant_hourly     per merchant per hour           kept 180 days
 *   taker_snapshots     change-only + daily heartbeat   kept 180 days
 *   ingest_runs         job log (health + "latest tick") kept 7 days
 *
 * `ts` columns are unix seconds. REAL in SQLite is a 64-bit double, so large
 * LKR sums keep full precision (the old 4-byte float lost it).
 */

const exchange = () => text("exchange", { enum: ["binance", "bybit"] }).notNull();

/** ── Market ───────────────────────────────────────────────────────────── */

/**
 * Column glossary for `market_snapshots` (raw) and `market_hourly` (`avg_`
 * prefix, hourly mean of the raw column):
 *
 *   bid_* / ask_*          bids = BUY ads (you sell USDT), asks = SELL ads
 *                          (you buy USDT).
 *   bid_depth, ask_depth   LEGACY. Σ `available` over the top 20 ads per side
 *   (+ _fiat)              (USDT; _fiat = Σ available × price, LKR). Includes
 *                          far-off and placeholder ads, so it is not what can
 *                          be traded near the current price. Kept for history.
 *   *_depth_05pct          NEAR-TOUCH depth: Σ min(available, maxOrder/price)
 *   *_depth_1pct           over ads priced within 0.5 % / 1 % of that SIDE's
 *   (+ _fiat)              best price (asks ≤ best·(1+x), bids ≥ best·(1−x)),
 *                          from up to 100 ads per side; offline and restricted
 *                          ads excluded (depth a typical taker can reach).
 *                          USDT; _fiat in LKR. Bid amounts are DECLARED budgets
 *                          (buy ads aren't escrowed); ask amounts are frozen
 *                          USDT. NULL on rows written before migration 0005.
 *   merchant_best_bid/ask  best prices of the verified-merchant book.
 */
const nearTouchCols = (p: "" | "avg_") => ({
  bidDepth05: real(`${p}bid_depth_05pct`),
  askDepth05: real(`${p}ask_depth_05pct`),
  bidDepth1: real(`${p}bid_depth_1pct`),
  askDepth1: real(`${p}ask_depth_1pct`),
  bidDepth05Fiat: real(`${p}bid_depth_05pct_fiat`),
  askDepth05Fiat: real(`${p}ask_depth_05pct_fiat`),
  bidDepth1Fiat: real(`${p}bid_depth_1pct_fiat`),
  askDepth1Fiat: real(`${p}ask_depth_1pct_fiat`),
});

export const marketSnapshots = sqliteTable(
  "market_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    exchange: exchange(),
    ts: integer("ts").notNull(),
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
    ...nearTouchCols(""),
    /** Best bid / ask of the verified-merchant book (the markets page
     *  default) at the same tick. NULL when that fetch failed. Everything
     *  else in the row describes the all-publishers book. */
    merchantBestBid: real("merchant_best_bid"),
    merchantBestAsk: real("merchant_best_ask"),
  },
  (t) => [
    uniqueIndex("ux_market_snap").on(t.exchange, t.asset, t.fiat, t.ts),
    index("ix_market_snap_ts").on(t.ts),
  ],
);

export const marketHourly = sqliteTable(
  "market_hourly",
  {
    exchange: exchange(),
    asset: text("asset").notNull(),
    fiat: text("fiat").notNull(),
    /** Start of the hour, unix seconds (UTC-aligned). */
    hourTs: integer("hour_ts").notNull(),
    samples: integer("samples").notNull(),
    openMid: real("open_mid"),
    highMid: real("high_mid"),
    lowMid: real("low_mid"),
    closeMid: real("close_mid"),
    avgMid: real("avg_mid"),
    avgBestBid: real("avg_best_bid"),
    avgBestAsk: real("avg_best_ask"),
    avgSpreadPct: real("avg_spread_pct"),
    avgBidDepth: real("avg_bid_depth"),
    avgAskDepth: real("avg_ask_depth"),
    avgBidDepthFiat: real("avg_bid_depth_fiat"),
    avgAskDepthFiat: real("avg_ask_depth_fiat"),
    avgBidCount: real("avg_bid_count"),
    avgAskCount: real("avg_ask_count"),
    ...nearTouchCols("avg_"),
    avgMerchantBestBid: real("avg_merchant_best_bid"),
    avgMerchantBestAsk: real("avg_merchant_best_ask"),
  },
  (t) => [primaryKey({ columns: [t.exchange, t.asset, t.fiat, t.hourTs] })],
);

/** ── Merchants (advertisers on the book) ──────────────────────────────── */

const merchantStats = {
  merchantName: text("merchant_name").notNull(),
  isMerchant: integer("is_merchant", { mode: "boolean" }),
  userIdentity: text("user_identity"),
  userGrade: integer("user_grade"),
  vipLevel: integer("vip_level"),
  ordersMonth: integer("orders_month"),
  completionRate: real("completion_rate"),
  avgReleaseSec: integer("avg_release_sec"),
  buyAds: integer("buy_ads"),
  sellAds: integer("sell_ads"),
  bestBuyPrice: real("best_buy_price"),
  bestSellPrice: real("best_sell_price"),
  totalAvailableFiat: real("total_available_fiat"),
  /** USDT the merchant lists per side (Σ available). Bids are declared
   *  budgets, asks are escrowed. NULL before migration 0005. */
  bidAvailable: real("bid_available"),
  askAvailable: real("ask_available"),
};

/** Latest known state per merchant. Replaces the old full-history scan. */
export const merchants = sqliteTable(
  "merchants",
  {
    exchange: exchange(),
    merchantId: text("merchant_id").notNull(),
    asset: text("asset").notNull(),
    fiat: text("fiat").notNull(),
    ...merchantStats,
    firstSeenTs: integer("first_seen_ts").notNull(),
    lastSeenTs: integer("last_seen_ts").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.exchange, t.merchantId, t.asset, t.fiat] }),
    index("ix_merchants_seen").on(t.exchange, t.asset, t.fiat, t.lastSeenTs),
  ],
);

export const merchantSnapshots = sqliteTable(
  "merchant_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    exchange: exchange(),
    ts: integer("ts").notNull(),
    asset: text("asset").notNull(),
    fiat: text("fiat").notNull(),
    merchantId: text("merchant_id").notNull(),
    ...merchantStats,
  },
  (t) => [
    index("ix_msnap_merchant").on(t.exchange, t.merchantId, t.ts),
    index("ix_msnap_market").on(t.exchange, t.asset, t.fiat, t.ts),
  ],
);

export const merchantHourly = sqliteTable(
  "merchant_hourly",
  {
    exchange: exchange(),
    merchantId: text("merchant_id").notNull(),
    asset: text("asset").notNull(),
    fiat: text("fiat").notNull(),
    hourTs: integer("hour_ts").notNull(),
    /** How many 10-min sweeps saw this merchant listing in the hour (0–6). */
    samples: integer("samples").notNull(),
    avgBuyPrice: real("avg_buy_price"),
    avgSellPrice: real("avg_sell_price"),
    maxAvailableFiat: real("max_available_fiat"),
    maxBuyAds: integer("max_buy_ads"),
    maxSellAds: integer("max_sell_ads"),
    ordersMonth: integer("orders_month"),
    completionRate: real("completion_rate"),
  },
  (t) => [
    primaryKey({ columns: [t.exchange, t.merchantId, t.asset, t.fiat, t.hourTs] }),
    index("ix_mhourly_market").on(t.exchange, t.asset, t.fiat, t.hourTs),
  ],
);

/** ── Takers (flagged users; polled from profile endpoints) ────────────── */

export const takerSnapshots = sqliteTable(
  "taker_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    exchange: exchange(),
    userId: text("user_id").notNull(),
    ts: integer("ts").notNull(),
    nickName: text("nick_name"),
    userIdentity: text("user_identity"),
    userGrade: integer("user_grade"),
    vipLevel: integer("vip_level"),
    ordersMonth: integer("orders_month"),
    completionRate: real("completion_rate"),
    avgReleaseSec: integer("avg_release_sec"),
  },
  (t) => [index("ix_taker_user_ts").on(t.exchange, t.userId, t.ts)],
);

/** ── Community registry ───────────────────────────────────────────────── */

export const suspiciousTakers = sqliteTable(
  "suspicious_takers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    exchange: exchange().default("binance"),
    ts: integer("ts").notNull(),
    /** Exchange user id (Binance `advertiserNo`, Bybit `userMaskId`). */
    userId: text("user_id").notNull(),
    profileUrl: text("profile_url").notNull(),
    displayName: text("display_name"),
    reason: text("reason").notNull(),
    notes: text("notes"),
    reporter: text("reporter"),
    /** pending = member submission awaiting moderation; active = public;
     *  rejected = moderator declined; retracted = removed after publishing. */
    status: text("status", { enum: ["pending", "active", "rejected", "retracted"] })
      .notNull()
      .default("active"),
    /** Account that submitted it (null for legacy/admin-imported rows). */
    submittedBy: text("submitted_by"),
    reviewedBy: text("reviewed_by"),
    reviewedTs: integer("reviewed_ts"),
    reviewNote: text("review_note"),
  },
  (t) => [
    index("ix_susp_user").on(t.exchange, t.userId, t.status),
    index("ix_susp_status_ts").on(t.status, t.ts),
  ],
);

export const suspiciousRemovalRequests = sqliteTable(
  "suspicious_removal_requests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    exchange: exchange().default("binance"),
    ts: integer("ts").notNull(),
    userId: text("user_id").notNull(),
    reason: text("reason").notNull(),
    reporterContact: text("reporter_contact"),
    status: text("status", { enum: ["pending", "approved", "rejected"] })
      .notNull()
      .default("pending"),
    reviewedTs: integer("reviewed_ts"),
    reviewNote: text("review_note"),
  },
  (t) => [
    index("ix_removal_user").on(t.exchange, t.userId),
    index("ix_removal_status_ts").on(t.status, t.ts),
  ],
);

/** ── Ops ──────────────────────────────────────────────────────────────── */

export const ingestRuns = sqliteTable(
  "ingest_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    exchange: text("exchange"),
    job: text("job", {
      enum: ["book", "sweep", "takers", "rollup", "retention", "fx", "alerts", "fx_google", "profiles", "push", "gold"],
    }).notNull(),
    ts: integer("ts").notNull(),
    durationMs: integer("duration_ms").notNull(),
    ok: integer("ok", { mode: "boolean" }).notNull(),
    rows: integer("rows").notNull().default(0),
    error: text("error"),
  },
  (t) => [index("ix_runs_job_ts").on(t.job, t.exchange, t.ts)],
);

export type MarketSnapshotRow = typeof marketSnapshots.$inferSelect;
export type MarketSnapshotInsert = typeof marketSnapshots.$inferInsert;
export type MarketHourlyRow = typeof marketHourly.$inferSelect;
export type MerchantRow = typeof merchants.$inferSelect;
export type MerchantSnapshotRow = typeof merchantSnapshots.$inferSelect;
export type MerchantSnapshotInsert = typeof merchantSnapshots.$inferInsert;
export type MerchantHourlyRow = typeof merchantHourly.$inferSelect;
export type TakerSnapshotRow = typeof takerSnapshots.$inferSelect;
export type SuspiciousTakerRow = typeof suspiciousTakers.$inferSelect;
export type SuspiciousTakerInsert = typeof suspiciousTakers.$inferInsert;
export type SuspiciousRemovalRequestRow = typeof suspiciousRemovalRequests.$inferSelect;
export type IngestRunRow = typeof ingestRuns.$inferSelect;

/** ── FX rates (CBSL + bank board rates; /rates page) ─────────────────────
 *
 *   fx_rates  one row per source × currency × rate type × day   kept forever
 *
 * Collected by lib/fx/collect.ts from each source's own public page. A re-run
 * on the same day upserts (the latest value of the day wins), so a source that
 * revises its rates intra-day never adds rows. `currency` is the foreign
 * currency (ISO 4217); every value is LKR per 1 unit of it. `as_of` is the
 * date the source says the rate applies to (YYYY-MM-DD, Sri Lanka time).
 */
export const FX_RATE_TYPES = [
  "indicative",
  "tt_buy",
  "tt_sell",
  "cash_buy",
  "cash_sell",
  /** Interbank mid-market (Google Finance) — daily close of fx_intraday. */
  "mid",
] as const;
export type FxRateType = (typeof FX_RATE_TYPES)[number];

export const fxRates = sqliteTable(
  "fx_rates",
  {
    source: text("source").notNull(),
    currency: text("currency").notNull(),
    rateType: text("rate_type", { enum: FX_RATE_TYPES }).notNull(),
    value: real("value").notNull(),
    asOf: text("as_of").notNull(),
    fetchedAt: integer("fetched_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.source, t.currency, t.rateType, t.asOf] }),
    index("ix_fx_cur_type_day").on(t.currency, t.rateType, t.asOf),
    index("ix_fx_day").on(t.asOf),
  ],
);

/** Intraday mid-market USD/LKR (Google Finance, every 30 min; kept 180 days).
 *  `value` is LKR per 1 USD; `prev_close` is Google's previous close, so the
 *  day's change is exact even before we have our own history. */
export const fxIntraday = sqliteTable(
  "fx_intraday",
  {
    source: text("source").notNull(),
    pair: text("pair").notNull(),
    ts: integer("ts").notNull(),
    value: real("value").notNull(),
    prevClose: real("prev_close"),
  },
  (t) => [primaryKey({ columns: [t.source, t.pair, t.ts] }), index("ix_fx_intraday_pair_ts").on(t.pair, t.ts)],
);
export type FxIntradayRow = typeof fxIntraday.$inferSelect;

/** Gold prices for the gold-vs-USDT signal (lib/gold-signals.ts). One row per
 *  source × karat × SLT day; the latest reading of the day wins.
 *    devi  Devi Jewellers, Colombo: LKR per pawn (8 g), business days
 *    uae   Dubai Gold & Jewellery Group board rate: AED per gram, 3× a day
 *  Kept forever (a few rows a day). Its own table so it never shows up in
 *  the /rates FX queries. */
export const goldPrices = sqliteTable(
  "gold_prices",
  {
    source: text("source").notNull(),
    /** 24 or 22. */
    karat: integer("karat").notNull(),
    /** SLT day the price is for, "YYYY-MM-DD". */
    day: text("day").notNull(),
    value: real("value").notNull(),
    fetchedAt: integer("fetched_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.source, t.karat, t.day] })],
);
export type GoldPriceRow = typeof goldPrices.$inferSelect;

export type FxRateRow = typeof fxRates.$inferSelect;
export type FxRateInsert = typeof fxRates.$inferInsert;

/** ── Accounts (Better Auth) ─────────────────────────────────────────────
 *
 * Property names are Better Auth's field names (the drizzle adapter maps by
 * them); column names stay snake_case. Roles and the onboarding status are
 * our own fields — see lib/auth/config.ts.
 *
 *   status: pending_email → pending_review → approved | rejected
 *           (suspended = approved account switched off by an admin)
 */
export const USER_STATUSES = [
  "pending_email",
  "pending_review",
  "approved",
  "rejected",
  "suspended",
] as const;
export type UserStatus = (typeof USER_STATUSES)[number];
export const USER_ROLES = ["user", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

const ms = (name: string) => integer(name, { mode: "timestamp_ms" });

export const user = sqliteTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
    image: text("image"),
    createdAt: ms("created_at").notNull(),
    updatedAt: ms("updated_at").notNull(),
    // P2P.LK fields
    merchantName: text("merchant_name").notNull().default(""),
    whatsapp: text("whatsapp").notNull().default(""),
    binanceUrl: text("binance_url"),
    bybitUrl: text("bybit_url"),
    role: text("role", { enum: USER_ROLES }).notNull().default("user"),
    status: text("status", { enum: USER_STATUSES }).notNull().default("pending_email"),
    reviewNote: text("review_note"),
    reviewedAt: ms("reviewed_at"),
    reviewedBy: text("reviewed_by"),
  },
  (t) => [index("ix_user_status").on(t.status, t.createdAt)],
);

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: ms("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: ms("created_at").notNull(),
    updatedAt: ms("updated_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("ix_session_user").on(t.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: ms("access_token_expires_at"),
    refreshTokenExpiresAt: ms("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: ms("created_at").notNull(),
    updatedAt: ms("updated_at").notNull(),
  },
  (t) => [index("ix_account_user").on(t.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: ms("expires_at").notNull(),
    createdAt: ms("created_at").notNull(),
    updatedAt: ms("updated_at").notNull(),
  },
  (t) => [index("ix_verification_identifier").on(t.identifier)],
);

export const rateLimit = sqliteTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: integer("last_request").notNull(),
});

export type UserRow = typeof user.$inferSelect;

/** ── Member data (synced across devices) ─────────────────────────────────
 *
 *   user_items     watchlist markets, favourite + blocked merchants, saved
 *                  filters — one generic table, JSON payload per item.
 *   alert_rules    server-side alert rules, evaluated by the cron each minute.
 *   alert_events   fired alerts (in-app inbox; emailed ones flagged).
 *   audit_log      every admin action (Phase 6 adds the viewer).
 */
export const USER_ITEM_KINDS = ["market", "merchant", "blocked_merchant", "filter"] as const;
export type UserItemKind = (typeof USER_ITEM_KINDS)[number];

export const userItems = sqliteTable(
  "user_items",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: USER_ITEM_KINDS }).notNull(),
    /** Stable key within the kind, e.g. "binance:USDT/LKR", "bybit:12345". */
    itemKey: text("item_key").notNull(),
    data: text("data", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kind, t.itemKey] })],
);

export const ALERT_TYPES = [
  "priceAbove",
  "priceBelow",
  "spreadAbove",
  "spreadBelow",
  /** LEGACY: top-20 depth, both sides added together. Kept so existing
   *  rules keep working; new rules use the per-side types below. */
  "depthBelow",
  /** Near-touch depth (within 1 % of that side's best price) on one side,
   *  in USDT. ask = sell ads (you buy), bid = buy ads (declared budgets). */
  "askDepthBelow",
  "bidDepthBelow",
  /** Taker signal: an ad priced at least `threshold` (fraction) better than
   *  the top-5 average on its side. */
  "offMarketAd",
  /** Dollar rate rules (threshold = fraction). Google USD/LKR change over
   *  2 h ≥ threshold (up) or ≤ −threshold (down); CBSL indicative day change
   *  vs the previous business day. The rule's exchange is used for the USDT
   *  context in the message. Text column, no SQL CHECK: no migration. */
  "usdGoogleUp",
  "usdGoogleDown",
  "usdCbslUp",
  "usdCbslDown",
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export const alertRules = sqliteTable(
  "alert_rules",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    exchange: exchange(),
    type: text("type", { enum: ALERT_TYPES }).notNull(),
    asset: text("asset").notNull(),
    fiat: text("fiat").notNull(),
    threshold: real("threshold").notNull(),
    label: text("label"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    email: integer("email", { mode: "boolean" }).notNull().default(true),
    cooldownSec: integer("cooldown_sec").notNull().default(1800),
    lastFiredAt: integer("last_fired_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("ix_alert_rules_user").on(t.userId),
    index("ix_alert_rules_enabled").on(t.enabled, t.exchange),
  ],
);

export const alertEvents = sqliteTable(
  "alert_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ruleId: text("rule_id").notNull(),
    ruleLabel: text("rule_label").notNull(),
    exchange: exchange(),
    type: text("type", { enum: ALERT_TYPES }).notNull(),
    observed: real("observed").notNull(),
    threshold: real("threshold").notNull(),
    detail: text("detail"),
    ts: integer("ts").notNull(),
    read: integer("read", { mode: "boolean" }).notNull().default(false),
    emailed: integer("emailed", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("ix_alert_events_user_ts").on(t.userId, t.ts)],
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ts: integer("ts").notNull(),
    actorId: text("actor_id"),
    actorEmail: text("actor_email"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    detail: text("detail", { mode: "json" }).$type<Record<string, unknown>>(),
  },
  (t) => [index("ix_audit_ts").on(t.ts), index("ix_audit_target").on(t.targetType, t.targetId)],
);

export type AlertRuleRow = typeof alertRules.$inferSelect;
export type AlertEventRow = typeof alertEvents.$inferSelect;
export type UserItemRow = typeof userItems.$inferSelect;

/** ── Merchant trade info (Binance profile; lib/ingest/profiles.ts) ──────
 *
 *   merchant_profiles      ONE row per merchant: the latest "Trade Info"
 *                          panel (all-time + 30-day buy/sell, release/pay
 *                          time, feedback, KYC…). `fetched_at` = last
 *                          attempt, `ok_at` = last success. A failed attempt
 *                          only updates fetched_at/ok/error and keeps the
 *                          last good values.                     kept forever
 *   merchant_trade_daily   per merchant per SLT day: the LAST cumulative
 *                          counters seen that day. Daily trades = this day −
 *                          the previous stored day (lib/trade-trend.ts).
 *                                                                kept 400 days
 *
 * Binance's counts cover ALL fiat markets the merchant trades, not LKR only.
 * Bybit's profile needs a login, so Bybit merchants have no rows here.
 */
export const merchantProfiles = sqliteTable(
  "merchant_profiles",
  {
    exchange: exchange(),
    merchantId: text("merchant_id").notNull(),
    fetchedAt: integer("fetched_at").notNull(),
    okAt: integer("ok_at"),
    ok: integer("ok", { mode: "boolean" }).notNull(),
    error: text("error"),
    nickName: text("nick_name"),
    completedOrders: integer("completed_orders"),
    completedBuy: integer("completed_buy"),
    completedSell: integer("completed_sell"),
    orders30d: integer("orders_30d"),
    buy30d: integer("buy_30d"),
    sell30d: integer("sell_30d"),
    completion30d: real("completion_30d"),
    avgReleaseSec: real("avg_release_sec"),
    avgPaySec: real("avg_pay_sec"),
    registerDays: integer("register_days"),
    firstTradeDays: integer("first_trade_days"),
    counterparties: integer("counterparties"),
    depositUsdt: real("deposit_usdt"),
    kycVerified: integer("kyc_verified", { mode: "boolean" }),
    emailVerified: integer("email_verified", { mode: "boolean" }),
    mobileVerified: integer("mobile_verified", { mode: "boolean" }),
    tradeType: text("trade_type"),
    userIdentity: text("user_identity"),
    vipLevel: integer("vip_level"),
    /** Epoch ms, as Binance reports it. */
    lastActiveMs: integer("last_active_ms"),
    positive: integer("positive"),
    negative: integer("negative"),
    positiveRate: real("positive_rate"),
  },
  (t) => [
    primaryKey({ columns: [t.exchange, t.merchantId] }),
    index("ix_mprof_fetched").on(t.exchange, t.fetchedAt),
  ],
);

export const merchantTradeDaily = sqliteTable(
  "merchant_trade_daily",
  {
    exchange: exchange(),
    merchantId: text("merchant_id").notNull(),
    /** SLT calendar day as days since 1970-01-01 (floor((ts + 19800) / 86400)). */
    day: integer("day").notNull(),
    completedBuy: integer("completed_buy"),
    completedSell: integer("completed_sell"),
    completedOrders: integer("completed_orders"),
    positive: integer("positive"),
    negative: integer("negative"),
    /** Unix seconds of the first / last fetch that day. */
    firstTs: integer("first_ts").notNull(),
    lastTs: integer("last_ts").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.exchange, t.merchantId, t.day] }),
    index("ix_mtd_day").on(t.exchange, t.day),
  ],
);

export type MerchantProfileRow = typeof merchantProfiles.$inferSelect;
export type MerchantTradeDailyRow = typeof merchantTradeDaily.$inferSelect;

/** ── Web Push (lib/push) ─────────────────────────────────────────────────
 *
 *   push_subscriptions  one row per browser/device subscription. Belongs to
 *                       the USER, not the session: session expiry keeps it;
 *                       explicit sign-out on that device removes it. Deleted
 *                       by the sender ONLY on 404/410 from the push service.
 *                       `failure_count` = consecutive failures (reset on
 *                       success); `next_attempt_at` = backoff after 429/5xx.
 *   push_tombstones     SHA-256 of endpoints that were removed (by the member,
 *                       "removed") or reported dead by the push service
 *                       ("gone"), so a background re-sync from that browser
 *                       can't silently bring a removed device back, and a dead
 *                       one is replaced instead of re-registered. Kept 90 days.
 *
 * All times are unix seconds.
 */
export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: integer("created_at").notNull(),
    /** Refreshed every time the app is opened/focused on that device. */
    lastSeenAt: integer("last_seen_at").notNull(),
    lastSuccessAt: integer("last_success_at"),
    failureCount: integer("failure_count").notNull().default(0),
    lastError: text("last_error"),
    lastErrorAt: integer("last_error_at"),
    nextAttemptAt: integer("next_attempt_at"),
  },
  (t) => [index("ix_push_user").on(t.userId)],
);

export const PUSH_TOMBSTONE_REASONS = ["gone", "removed"] as const;

export const pushTombstones = sqliteTable(
  "push_tombstones",
  {
    endpointHash: text("endpoint_hash").primaryKey(),
    /** Who it belonged to (no FK: kept after the account is gone, for 90 days). */
    userId: text("user_id"),
    reason: text("reason", { enum: PUSH_TOMBSTONE_REASONS }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("ix_push_tomb_created").on(t.createdAt)],
);

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
