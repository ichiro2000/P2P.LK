import { and, eq, isNotNull, sql } from "drizzle-orm";
import { buildMarket, summarizeMerchants } from "@/lib/analytics";
import { ASSET, FIAT } from "@/lib/constants";
import { schema, type Db } from "@/lib/db/client";
import { getExchange, type ExchangeId, type Book } from "@/lib/exchanges";
import { LIVE_DEEP_N, putLiveBook } from "@/lib/live";
import { alertRetentionSql } from "@/lib/alerts/evaluate";
import { availableBySide, nearTouchCols } from "@/lib/near-touch";
import { sltDay } from "@/lib/trade-trend";

export type JobEnv = { db: Db; kv: KVNamespace };
/** `book` (up to DEEP_N per side) is returned by the book/sweep jobs so the
 *  alert engine can evaluate the same data in memory without refetching. */
export type JobResult = { rows: number; book?: Pick<Book, "buy" | "sell"> };

const MARKET = { asset: ASSET, fiat: FIAT.code } as const;
/** The market snapshot always describes the top 20 per side, so numbers stay
 *  comparable whether they came from a 1-min book tick or a 10-min sweep. */
const TOP_N = 20;
/** Ads per side kept in KV and used for near-touch depth. Deep enough for a
 *  real "your rank on the book" (F15) and for every ad within 1 % of the
 *  best price; the 1-min tick fetches DEEP_PAGES pages of 20 per side. */
export const DEEP_N = LIVE_DEEP_N;
const DEEP_PAGES = DEEP_N / 20;

export const RETENTION_SEC = {
  marketSnapshots: 14 * 86400,
  merchantSnapshots: 3 * 86400,
  merchantHourly: 180 * 86400,
  takerSnapshots: 180 * 86400,
  ingestRuns: 7 * 86400,
  fxIntraday: 180 * 86400,
  /** merchant_trade_daily, in SLT days (lib/trade-trend sltDay). */
  merchantTradeDailyDays: 400,
};

async function writeBook(env: JobEnv, ex: ExchangeId, ts: number, book: Book, merchantBook: Book | null) {
  const top = { buy: book.buy.slice(0, TOP_N), sell: book.sell.slice(0, TOP_N) };
  const deep = { buy: book.buy.slice(0, DEEP_N), sell: book.sell.slice(0, DEEP_N) };
  const snap = buildMarket(MARKET.asset, MARKET.fiat, [...top.buy, ...top.sell]);
  // Same best-price definition as the all-publishers book, on the merchant book.
  const mSnap = merchantBook
    ? buildMarket(MARKET.asset, MARKET.fiat, [...merchantBook.buy, ...merchantBook.sell])
    : null;

  await Promise.all([
    // KV keeps DEEP_N per side; getBook() slices to what each reader asks for.
    putLiveBook(env.kv, { exchange: ex, variant: "all", ...MARKET, ts, ...deep }),
    env.db
      .insert(schema.marketSnapshots)
      .values({
        exchange: ex,
        ts,
        ...MARKET,
        bestBid: snap.buy.bestPrice,
        bestAsk: snap.sell.bestPrice,
        mid: snap.mid,
        spread: snap.spread,
        spreadPct: snap.spreadPct,
        medianBid: snap.buy.medianPrice,
        medianAsk: snap.sell.medianPrice,
        vwapBid: snap.buy.vwap,
        vwapAsk: snap.sell.vwap,
        bidCount: snap.buy.count,
        askCount: snap.sell.count,
        bidDepth: snap.buy.totalAvailable,
        askDepth: snap.sell.totalAvailable,
        bidDepthFiat: snap.buy.totalAvailableFiat,
        askDepthFiat: snap.sell.totalAvailableFiat,
        ...nearTouchCols(deep),
        merchantBestBid: mSnap?.buy.bestPrice ?? null,
        merchantBestAsk: mSnap?.sell.bestPrice ?? null,
      })
      .onConflictDoNothing(),
  ]);
  return snap;
}

type ReleaseMap = Map<string, number>;

/** Avg release time per merchant from the Binance "Trade Info" profiles
 *  (lib/ingest/profiles.ts). Neither search endpoint sends it any more, so
 *  without this the Release column and the merchant directory stay empty.
 *  Never throws: an empty map just leaves ads as they came. */
async function releaseTimes(db: Db, ex: ExchangeId): Promise<ReleaseMap> {
  if (ex !== "binance") return new Map();
  try {
    const p = schema.merchantProfiles;
    const rows = await db
      .select({ id: p.merchantId, sec: p.avgReleaseSec })
      .from(p)
      .where(and(eq(p.exchange, ex), isNotNull(p.avgReleaseSec)));
    return new Map(rows.map((r) => [r.id, r.sec as number]));
  } catch (err) {
    console.warn(`[ingest] release times ${ex}: ${(err as Error).message}`);
    return new Map();
  }
}

/** Fill `merchant.avgReleaseSec` where the exchange left it empty. */
export function withReleaseTimes<B extends Pick<Book, "buy" | "sell">>(book: B, rel: ReleaseMap): B {
  if (rel.size === 0) return book;
  const fill = (ads: Book["buy"]) =>
    ads.map((a) => {
      if (a.merchant.avgReleaseSec != null) return a;
      const sec = rel.get(a.merchant.id);
      return sec == null ? a : { ...a, merchant: { ...a.merchant, avgReleaseSec: sec } };
    });
  return { ...book, buy: fill(book.buy), sell: fill(book.sell) };
}

/** Verified-merchants-only book (the markets page default) → KV. A failure
 *  here is logged but doesn't fail the tick; the page falls back to live.
 *  Returns the book (null on failure) so its best prices are stored too. */
async function cacheMerchantBook(
  env: JobEnv,
  ex: ExchangeId,
  ts: number,
  rel: Promise<ReleaseMap>,
): Promise<Book | null> {
  const adapter = getExchange(ex);
  try {
    const fetched = await adapter.fetchBook({
      ...MARKET,
      payTypes: adapter.bankPayTypes.map((p) => p.id),
      publisherType: "merchant",
    });
    const b = withReleaseTimes(fetched, await rel);
    await putLiveBook(env.kv, { exchange: ex, variant: "merchant", ...MARKET, ts, ...b });
    return b;
  } catch (err) {
    console.warn(`[ingest] merchant book ${ex}: ${(err as Error).message}`);
    return null;
  }
}

/** Every minute: the top DEEP_N ads per side → KV + one market_snapshots row.
 *  A failure after page 1 just returns a shorter book (see `sweep`). */
export async function bookTick(env: JobEnv, ex: ExchangeId, ts: number): Promise<JobResult> {
  const adapter = getExchange(ex);
  const q = { ...MARKET, payTypes: adapter.bankPayTypes.map((p) => p.id) };
  const rel = releaseTimes(env.db, ex);
  const [fetched, merchantBook] = await Promise.all([
    adapter.fetchDeep(q, { pagesPerSide: DEEP_PAGES, rowsPerPage: 20 }),
    cacheMerchantBook(env, ex, ts, rel),
  ]);
  const book = withReleaseTimes(fetched, await rel);
  await writeBook(env, ex, ts, book, merchantBook);
  return { rows: 1, book: { buy: book.buy.slice(0, DEEP_N), sell: book.sell.slice(0, DEEP_N) } };
}

/**
 * Every 10 minutes: paginate the whole book, refresh the merchant directory
 * (`merchants` latest row + raw `merchant_snapshots`), and write the book too
 * (it supersedes the 1-min tick for that minute).
 */
export async function sweepTick(env: JobEnv, ex: ExchangeId, ts: number): Promise<JobResult> {
  const adapter = getExchange(ex);
  const rel = releaseTimes(env.db, ex);
  const [fetched, merchantBook] = await Promise.all([
    adapter.fetchDeep(
      { ...MARKET, payTypes: adapter.bankPayTypes.map((p) => p.id) },
      { pagesPerSide: 15, rowsPerPage: 20 },
    ),
    cacheMerchantBook(env, ex, ts, rel),
  ]);
  const book = withReleaseTimes(fetched, await rel);
  const snap = await writeBook(env, ex, ts, book, merchantBook);
  const median = snap.sell.medianPrice ?? snap.buy.medianPrice ?? null;
  const summaries = summarizeMerchants([...book.buy, ...book.sell], median);
  const top = { buy: book.buy.slice(0, DEEP_N), sell: book.sell.slice(0, DEEP_N) };
  if (summaries.length === 0) return { rows: 1, book: top };
  const bySide = availableBySide([...book.buy, ...book.sell]);

  const statements = summaries.flatMap((m) => {
    const stats = {
      merchantName: m.name,
      isMerchant: m.isMerchant,
      userIdentity: m.userIdentity ?? null,
      userGrade: m.grade ?? null,
      vipLevel: m.vipLevel ?? null,
      ordersMonth: m.orders30d,
      completionRate: m.completionRate,
      avgReleaseSec: m.avgReleaseSec != null ? Math.round(m.avgReleaseSec) : null,
      buyAds: m.buyAds,
      sellAds: m.sellAds,
      bestBuyPrice: m.bestBuyPrice,
      bestSellPrice: m.bestSellPrice,
      totalAvailableFiat: m.totalAvailableFiat,
      bidAvailable: bySide.get(m.id)?.bid ?? null,
      askAvailable: bySide.get(m.id)?.ask ?? null,
    };
    const ids = { exchange: ex, merchantId: m.id, ...MARKET };
    return [
      env.db.insert(schema.merchantSnapshots).values({ ...ids, ts, ...stats }),
      env.db
        .insert(schema.merchants)
        .values({ ...ids, ...stats, firstSeenTs: ts, lastSeenTs: ts })
        .onConflictDoUpdate({
          target: [
            schema.merchants.exchange,
            schema.merchants.merchantId,
            schema.merchants.asset,
            schema.merchants.fiat,
          ],
          set: { ...stats, lastSeenTs: ts },
        }),
    ];
  });
  // One round trip, one transaction.
  await env.db.batch(statements as [(typeof statements)[number], ...typeof statements]);
  return { rows: 1 + summaries.length * 2, book: top };
}

/**
 * Recompute hourly rollups for the last `hours` hours (idempotent — INSERT OR
 * REPLACE). Runs with each 10-min sweep so the current partial hour is always fresh; the
 * cron passes 1 (2 in the first 10 minutes of an hour) to keep D1 writes low.
 */
export async function rollupTick(env: JobEnv, nowTs: number, hours = 3): Promise<JobResult> {
  const since = Math.floor(nowTs / 3600) * 3600 - (hours - 1) * 3600;
  // drizzle's raw `db.run` isn't batchable on D1; two sequential statements.
  const results = [
    await env.db.run(sql`
      INSERT OR REPLACE INTO market_hourly (
        exchange, asset, fiat, hour_ts, samples,
        open_mid, high_mid, low_mid, close_mid, avg_mid,
        avg_best_bid, avg_best_ask, avg_spread_pct,
        avg_bid_depth, avg_ask_depth, avg_bid_depth_fiat, avg_ask_depth_fiat,
        avg_bid_count, avg_ask_count,
        avg_bid_depth_05pct, avg_ask_depth_05pct, avg_bid_depth_1pct, avg_ask_depth_1pct,
        avg_bid_depth_05pct_fiat, avg_ask_depth_05pct_fiat, avg_bid_depth_1pct_fiat, avg_ask_depth_1pct_fiat,
        avg_merchant_best_bid, avg_merchant_best_ask)
      SELECT exchange, asset, fiat, h, count(*),
        max(o), max(mid), min(mid), max(c), avg(mid),
        avg(best_bid), avg(best_ask), avg(spread_pct),
        avg(bid_depth), avg(ask_depth), avg(bid_depth_fiat), avg(ask_depth_fiat),
        avg(bid_count), avg(ask_count),
        avg(bid_depth_05pct), avg(ask_depth_05pct), avg(bid_depth_1pct), avg(ask_depth_1pct),
        avg(bid_depth_05pct_fiat), avg(ask_depth_05pct_fiat), avg(bid_depth_1pct_fiat), avg(ask_depth_1pct_fiat),
        avg(merchant_best_bid), avg(merchant_best_ask)
      FROM (
        SELECT *, (ts / 3600) * 3600 AS h,
          first_value(mid) OVER w AS o,
          last_value(mid) OVER w AS c
        FROM market_snapshots
        WHERE ts >= ${since} AND mid IS NOT NULL
        WINDOW w AS (PARTITION BY exchange, asset, fiat, ts / 3600 ORDER BY ts
                     ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
      )
      GROUP BY exchange, asset, fiat, h
    `),
    await env.db.run(sql`
      INSERT OR REPLACE INTO merchant_hourly (
        exchange, merchant_id, asset, fiat, hour_ts, samples,
        avg_buy_price, avg_sell_price, max_available_fiat,
        max_buy_ads, max_sell_ads, orders_month, completion_rate)
      SELECT exchange, merchant_id, asset, fiat, (ts / 3600) * 3600, count(*),
        avg(best_buy_price), avg(best_sell_price), max(total_available_fiat),
        max(buy_ads), max(sell_ads), max(orders_month), avg(completion_rate)
      FROM merchant_snapshots
      WHERE ts >= ${since}
      GROUP BY exchange, merchant_id, asset, fiat, (ts / 3600)
    `),
  ];
  return { rows: results.reduce((n, r) => n + (r.meta?.changes ?? 0), 0) };
}

/** Daily: drop raw data past its retention window. */
export async function retentionTick(env: JobEnv, nowTs: number): Promise<JobResult> {
  const r = RETENTION_SEC;
  const results = [
    await env.db.run(sql`DELETE FROM market_snapshots WHERE ts < ${nowTs - r.marketSnapshots}`),
    await env.db.run(sql`DELETE FROM merchant_snapshots WHERE ts < ${nowTs - r.merchantSnapshots}`),
    await env.db.run(sql`DELETE FROM merchant_hourly WHERE hour_ts < ${nowTs - r.merchantHourly}`),
    await env.db.run(sql`DELETE FROM taker_snapshots WHERE ts < ${nowTs - r.takerSnapshots}`),
    await env.db.run(sql`DELETE FROM ingest_runs WHERE ts < ${nowTs - r.ingestRuns}`),
    await env.db.run(sql`DELETE FROM fx_intraday WHERE ts < ${nowTs - r.fxIntraday}`),
    await env.db.run(
      sql`DELETE FROM merchant_trade_daily WHERE day < ${sql.raw(String(sltDay(nowTs) - r.merchantTradeDailyDays))}`,
    ),
    // alert_events: 30 days, max 500 per user (lib/alerts/evaluate).
    ...(await Promise.all(alertRetentionSql(nowTs).map((q) => env.db.run(q)))),
  ];
  return { rows: results.reduce((n, r) => n + (r.meta?.changes ?? 0), 0) };
}
