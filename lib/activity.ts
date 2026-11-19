import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { SLT_OFFSET_SEC } from "@/lib/constants";
import type { ExchangeId } from "@/lib/exchanges";
import { freshness } from "@/lib/db/queries";

/**
 * Activity index: how busy the LKR book is now vs the day before.
 *
 * Real trade volume is not public on either exchange, so everything here is
 * built from what the ads and merchant profiles show:
 *   - orders     ORDERS INDEX (D9): Σ over merchants of the rise in their
 *                30-day order count between back-to-back 10-min sweeps. Orders
 *                that roll out of the 30-day window pull the count down, so
 *                this undercounts; it's an index of activity, not volume.
 *                Price edits and ad resizes don't move it (F14).
 *   - ads        live ads per hour (peak per merchant per hour, summed)
 *   - merchants  distinct advertisers seen in the hour
 *   - nearAsk / nearBid
 *                near-touch depth: USDT within 1 % of each side's best price
 *                (market_snapshots). Bids are declared budgets, not escrowed.
 *
 * Hours are exact Sri Lanka hours (UTC+05:30), bucketed in SQL on integers.
 * Windows: "current" = last 24 h, "previous" = the 24 h before. Hour averages
 * use only hours that have data, so a thin history still gives fair numbers;
 * the orders index is scaled per covered hour for the change.
 */

const DAY = 86_400;
/** Gap allowed between two sweeps to count as consecutive (sweeps are 10
 *  min; one missed sweep is still consecutive). */
export const MAX_SWEEP_GAP = 25 * 60;
/** A rise bigger than this between two sweeps is a data glitch (e.g. a
 *  lifetime count slipping in), not 10 minutes of trading. */
export const MAX_ORDERS_STEP = 400;

export type ActivityWindow = {
  /** Hours with sweep data in the window. */
  hours: number;
  ads: number | null;
  merchants: number | null;
  /** Orders index: Σ positive Δ 30-day orders across merchants (count). */
  orders: number | null;
  /** Mean near-touch depth within 1 %, USDT (asks escrowed, bids declared). */
  nearAsk: number | null;
  nearBid: number | null;
};

export type ActivityMerchant = {
  merchantId: string;
  name: string;
  ordersNow: number;
  ordersPrev: number;
  adsNow: number | null;
  adsPrev: number | null;
  /** USDT listed per side at the merchant's latest sweep (null before 0005). */
  askAvailable: number | null;
  bidAvailable: number | null;
  adsChange: number | null;
  ordersChange: number | null;
};

export type ActivityHour = {
  /** Start of the Sri Lanka hour, unix seconds. */
  ts: number;
  ads: number;
  merchants: number;
  orders: number;
  nearAsk: number | null;
  nearBid: number | null;
};

export type ActivityIndex = {
  exchange: ExchangeId;
  generatedAt: number;
  /** Newest sweep in the data (unix s), for "as of". */
  latestSweepTs: number | null;
  /** Latest sweep older than 10 minutes (F24). */
  latestSweepStale: boolean;
  current: ActivityWindow;
  previous: ActivityWindow | null;
  change: {
    ads: number | null;
    merchants: number | null;
    /** Per covered hour. */
    orders: number | null;
    nearAsk: number | null;
  };
  /** Last 48 h, one point per SLT hour that has data. */
  hourly: ActivityHour[];
  /** Top merchants by orders index in the last 24 h. */
  merchants: ActivityMerchant[];
};

const pctChange = (now: number | null, prev: number | null) =>
  now != null && prev != null && prev > 0 ? (now - prev) / prev : null;

/** SQL for the start of the Sri Lanka hour of `ts` (integer maths, inlined). */
const sltHour = (col: string) => sql.raw(`((${col} + ${SLT_OFFSET_SEC}) / 3600) * 3600 - ${SLT_OFFSET_SEC}`);

/** Start of the SLT hour containing `ts` (JS twin of the SQL above). */
export const sltHourStart = (ts: number) =>
  Math.floor((ts + SLT_OFFSET_SEC) / 3600) * 3600 - SLT_OFFSET_SEC;

export async function activityIndex(
  ex: ExchangeId,
  asset: string,
  fiat: string,
  opts: { topMerchants?: number } = {},
): Promise<ActivityIndex> {
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  const mid = sltHourStart(now - DAY);
  const since = sltHourStart(now - 2 * DAY);
  const H = sltHour("ts");

  const [hourRows, orderHourRows, nearRows, merchantRows, latestRows] = await Promise.all([
    // Ads and advertisers per SLT hour: peak ads per merchant, summed.
    db.all<{ ts: number; ads: number; merchants: number }>(sql`
      SELECT h AS ts, sum(ads) AS ads, count(*) AS merchants
      FROM (
        SELECT ${H} AS h, merchant_id,
          max(coalesce(buy_ads, 0) + coalesce(sell_ads, 0)) AS ads
        FROM merchant_snapshots
        WHERE exchange = ${ex} AND asset = ${asset} AND fiat = ${fiat} AND ts >= ${since}
        GROUP BY h, merchant_id
      )
      GROUP BY h
      ORDER BY h
    `),
    // Orders index per SLT hour.
    db.all<{ ts: number; orders: number }>(sql`
      SELECT ${H} AS ts, sum(d) AS orders
      FROM (${ordersDeltas(ex, asset, fiat, since)})
      GROUP BY 1
      ORDER BY 1
    `),
    // Near-touch depth per SLT hour.
    db.all<{ ts: number; ask: number | null; bid: number | null }>(sql`
      SELECT ${H} AS ts, avg(ask_depth_1pct) AS ask, avg(bid_depth_1pct) AS bid
      FROM market_snapshots
      WHERE exchange = ${ex} AND asset = ${asset} AND fiat = ${fiat} AND ts >= ${since}
      GROUP BY 1
      ORDER BY 1
    `),
    // Per merchant: orders index and ads, now vs before.
    db.all<{
      merchantId: string;
      name: string | null;
      ordersA: number;
      ordersB: number;
      adsA: number;
      adsB: number;
      hoursA: number;
      hoursB: number;
    }>(sql`
      SELECT a.merchant_id AS merchantId,
        max(m.merchant_name) AS name,
        coalesce(max(o.oa), 0) AS ordersA,
        coalesce(max(o.ob), 0) AS ordersB,
        sum(CASE WHEN a.h >= ${mid} THEN a.ads ELSE 0 END) AS adsA,
        sum(CASE WHEN a.h <  ${mid} THEN a.ads ELSE 0 END) AS adsB,
        sum(CASE WHEN a.h >= ${mid} THEN 1 ELSE 0 END) AS hoursA,
        sum(CASE WHEN a.h <  ${mid} THEN 1 ELSE 0 END) AS hoursB
      FROM (
        SELECT merchant_id, ${H} AS h, max(coalesce(buy_ads, 0) + coalesce(sell_ads, 0)) AS ads
        FROM merchant_snapshots
        WHERE exchange = ${ex} AND asset = ${asset} AND fiat = ${fiat} AND ts >= ${since}
        GROUP BY merchant_id, h
      ) a
      LEFT JOIN (
        SELECT merchant_id,
          sum(CASE WHEN ts >= ${mid} THEN d ELSE 0 END) AS oa,
          sum(CASE WHEN ts <  ${mid} THEN d ELSE 0 END) AS ob
        FROM (${ordersDeltas(ex, asset, fiat, since)})
        GROUP BY merchant_id
      ) o ON o.merchant_id = a.merchant_id
      LEFT JOIN merchants m
        ON m.exchange = ${ex} AND m.merchant_id = a.merchant_id AND m.asset = ${asset} AND m.fiat = ${fiat}
      GROUP BY a.merchant_id
    `),
    // Latest sweep, and each merchant's per-side USDT at it.
    db.all<{ merchantId: string; ts: number; ask: number | null; bid: number | null }>(sql`
      SELECT merchant_id AS merchantId, ts, ask_available AS ask, bid_available AS bid
      FROM merchant_snapshots
      WHERE exchange = ${ex} AND asset = ${asset} AND fiat = ${fiat}
        AND ts = (SELECT max(ts) FROM merchant_snapshots
                  WHERE exchange = ${ex} AND asset = ${asset} AND fiat = ${fiat} AND ts >= ${since})
    `),
  ]);

  const orders = new Map(orderHourRows.map((r) => [Number(r.ts), Number(r.orders) || 0]));
  const near = new Map(nearRows.map((r) => [Number(r.ts), r]));
  const num = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const hourly: ActivityHour[] = hourRows.map((r) => {
    const ts = Number(r.ts);
    const nr = near.get(ts);
    return {
      ts,
      ads: Number(r.ads) || 0,
      merchants: Number(r.merchants) || 0,
      orders: orders.get(ts) ?? 0,
      nearAsk: num(nr?.ask),
      nearBid: num(nr?.bid),
    };
  });

  const curH = hourly.filter((h) => h.ts >= mid);
  const prevH = hourly.filter((h) => h.ts < mid);
  const avg = (xs: ActivityHour[], k: "ads" | "merchants" | "nearAsk" | "nearBid") => {
    const v = xs.map((x) => x[k]).filter((x): x is number => x != null);
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
  };
  const sum = (xs: ActivityHour[]) => xs.reduce((s, x) => s + x.orders, 0);
  const win = (xs: ActivityHour[]): ActivityWindow => ({
    hours: xs.length,
    ads: avg(xs, "ads"),
    merchants: avg(xs, "merchants"),
    orders: xs.length ? sum(xs) : null,
    nearAsk: avg(xs, "nearAsk"),
    nearBid: avg(xs, "nearBid"),
  });
  const current = win(curH);
  const previous = prevH.length ? win(prevH) : null;

  const latest = new Map(latestRows.map((r) => [r.merchantId, r]));
  const merchants: ActivityMerchant[] = merchantRows
    .map((r) => {
      const hA = Number(r.hoursA) || 0;
      const hB = Number(r.hoursB) || 0;
      const adsNow = hA ? Number(r.adsA) / hA : null;
      const adsPrev = hB ? Number(r.adsB) / hB : null;
      const ordersNow = Number(r.ordersA) || 0;
      const ordersPrev = Number(r.ordersB) || 0;
      const l = latest.get(r.merchantId);
      return {
        merchantId: r.merchantId,
        name: r.name ?? r.merchantId,
        ordersNow,
        ordersPrev,
        adsNow,
        adsPrev,
        askAvailable: num(l?.ask),
        bidAvailable: num(l?.bid),
        adsChange: pctChange(adsNow, adsPrev),
        ordersChange: pctChange(hA ? ordersNow / hA : null, hB ? ordersPrev / hB : null),
      };
    })
    .filter((m) => m.ordersNow > 0 || (m.adsNow ?? 0) > 0)
    .sort((a, b) => b.ordersNow - a.ordersNow || (b.adsNow ?? 0) - (a.adsNow ?? 0))
    .slice(0, opts.topMerchants ?? 20);

  return {
    exchange: ex,
    generatedAt: now,
    latestSweepTs: latestRows.length ? Number(latestRows[0].ts) : null,
    latestSweepStale: freshness(latestRows.length ? Number(latestRows[0].ts) : null, now).stale,
    current,
    previous,
    change: {
      ads: pctChange(current.ads, previous?.ads ?? null),
      merchants: pctChange(current.merchants, previous?.merchants ?? null),
      // A sum, so compare per covered hour.
      orders: pctChange(
        current.orders != null && current.hours ? current.orders / current.hours : null,
        previous?.orders != null && previous.hours ? previous.orders / previous.hours : null,
      ),
      nearAsk: pctChange(current.nearAsk, previous?.nearAsk ?? null),
    },
    hourly,
    merchants,
  };
}

/**
 * Rows (merchant_id, ts, d): the rise in a merchant's 30-day order count since
 * their previous sweep, when the two sweeps are back to back and the rise is
 * plausible. Falls (orders ageing out of the 30-day window) count as 0.
 */
function ordersDeltas(ex: ExchangeId, asset: string, fiat: string, since: number) {
  return sql`
    SELECT merchant_id, ts,
      CASE
        WHEN prev_ts IS NOT NULL
         AND ts - prev_ts <= ${sql.raw(String(MAX_SWEEP_GAP))}
         AND orders_month > prev_orders
         AND orders_month - prev_orders <= ${sql.raw(String(MAX_ORDERS_STEP))}
        THEN orders_month - prev_orders ELSE 0
      END AS d
    FROM (
      SELECT merchant_id, ts, orders_month,
        lag(ts) OVER w AS prev_ts,
        lag(orders_month) OVER w AS prev_orders
      FROM merchant_snapshots
      WHERE exchange = ${ex} AND asset = ${asset} AND fiat = ${fiat} AND ts >= ${since}
        AND orders_month IS NOT NULL
      WINDOW w AS (PARTITION BY merchant_id ORDER BY ts)
    )
  `;
}
