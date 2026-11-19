import "server-only";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { getBook } from "@/lib/market-data";
import { buildMarket } from "@/lib/analytics";
import { ASSET, FIAT } from "@/lib/constants";
import { EXCHANGE_IDS, type ExchangeId } from "@/lib/exchanges";
import { GOOGLE_SOURCE } from "./google";

/**
 * Google mid-market USD/LKR next to the USDT P2P price.
 *
 * Premium = P2P price ÷ Google USD/LKR − 1. Shown for the three prices a
 * trader acts on: buying USDT (lowest Sell-ad price), selling USDT (highest
 * Buy-ad price) and the mid. Every P2P point is paired with the Google reading
 * that was current at that moment (last reading at or before it), never one
 * from the future.
 */

export const GOOGLE_RANGES = { "24h": 86400, "7d": 7 * 86400, "30d": 30 * 86400 } as const;
export type GoogleRange = keyof typeof GOOGLE_RANGES;
export const parseGoogleRange = (v: unknown): GoogleRange =>
  typeof v === "string" && v in GOOGLE_RANGES ? (v as GoogleRange) : "24h";

export type GoogleNow = {
  value: number;
  prevClose: number | null;
  /** value ÷ prevClose − 1 */
  change: number | null;
  ts: number;
  /** Minutes since the reading; > 75 means the collector is behind. */
  ageMin: number;
};

export type P2PVsGoogle = {
  exchange: ExchangeId;
  buy: number | null;
  sell: number | null;
  mid: number | null;
  buyPremium: number | null;
  sellPremium: number | null;
  midPremium: number | null;
};

export type GooglePoint = {
  t: number; // ms
  google: number | null;
  binance: number | null;
  bybit: number | null;
  binancePremium: number | null;
  bybitPremium: number | null;
};

const prem = (p: number | null, g: number | null) => (p != null && g ? p / g - 1 : null);

export async function latestGoogle(): Promise<GoogleNow | null> {
  const db = await getDb();
  const row = await db.query.fxIntraday.findFirst({
    where: and(eq(schema.fxIntraday.source, GOOGLE_SOURCE.id), eq(schema.fxIntraday.pair, "USD/LKR")),
    orderBy: desc(schema.fxIntraday.ts),
  });
  if (!row) return null;
  return {
    value: row.value,
    prevClose: row.prevClose,
    change: row.prevClose ? row.value / row.prevClose - 1 : null,
    ts: row.ts,
    ageMin: Math.round((Date.now() / 1000 - row.ts) / 60),
  };
}

/** Live P2P prices (KV book) vs the latest Google rate, per exchange. */
export async function p2pVsGoogle(google: number | null): Promise<P2PVsGoogle[]> {
  return Promise.all(
    EXCHANGE_IDS.map(async (exchange) => {
      try {
        const book = await getBook(exchange, { asset: ASSET, fiat: FIAT.code, publisherType: "merchant" });
        const m = buildMarket(ASSET, FIAT.code, [...book.buy, ...book.sell]);
        // User perspective: buy USDT at the cheapest Sell ad, sell at the best Buy ad.
        const buy = m.sell.bestPrice;
        const sell = m.buy.bestPrice;
        return {
          exchange,
          buy,
          sell,
          mid: m.mid,
          buyPremium: prem(buy, google),
          sellPremium: prem(sell, google),
          midPremium: prem(m.mid, google),
        };
      } catch {
        return { exchange, buy: null, sell: null, mid: null, buyPremium: null, sellPremium: null, midPremium: null };
      }
    }),
  );
}

/**
 * Time series for the chart. 24h/7d use the 1-minute snapshots bucketed to
 * 30 minutes (Google's cadence); 30d uses the hourly rollups. Gaps stay null
 * (never 0) so lines break instead of diving.
 */
export async function googleSeries(range: GoogleRange): Promise<GooglePoint[]> {
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  const since = now - GOOGLE_RANGES[range];
  const bucket = range === "30d" ? 3 * 3600 : range === "7d" ? 3600 : 1800;
  // D1 binds JS numbers as REAL, which would make `ts / bucket` a float and
  // skip the bucketing. `bucket` is one of three constants, so inline it.
  const B = sql.raw(String(bucket));

  const [googleRows, p2pRows] = await Promise.all([
    db
      .select({ ts: schema.fxIntraday.ts, value: schema.fxIntraday.value })
      .from(schema.fxIntraday)
      .where(and(eq(schema.fxIntraday.pair, "USD/LKR"), eq(schema.fxIntraday.source, GOOGLE_SOURCE.id), gte(schema.fxIntraday.ts, since - 86400)))
      .orderBy(asc(schema.fxIntraday.ts)),
    range === "30d"
      ? db
          .select({
            exchange: schema.marketHourly.exchange,
            b: sql<number>`(${schema.marketHourly.hourTs} / ${B}) * ${B}`.as("b"),
            mid: sql<number | null>`avg(${schema.marketHourly.avgMid})`,
          })
          .from(schema.marketHourly)
          .where(gte(schema.marketHourly.hourTs, since))
          .groupBy(schema.marketHourly.exchange, sql`b`)
      : db
          .select({
            exchange: schema.marketSnapshots.exchange,
            b: sql<number>`(${schema.marketSnapshots.ts} / ${B}) * ${B}`.as("b"),
            mid: sql<number | null>`avg(${schema.marketSnapshots.mid})`,
          })
          .from(schema.marketSnapshots)
          .where(gte(schema.marketSnapshots.ts, since))
          .groupBy(schema.marketSnapshots.exchange, sql`b`),
  ]);

  const buckets = new Map<number, { binance: number | null; bybit: number | null }>();
  for (const r of p2pRows) {
    const k = Number(r.b);
    const cur = buckets.get(k) ?? { binance: null, bybit: null };
    cur[r.exchange] = r.mid == null ? null : Number(r.mid);
    buckets.set(k, cur);
  }

  // Google value current at time t: last reading at or before t (step).
  let gi = -1;
  const googleAt = (t: number) => {
    while (gi + 1 < googleRows.length && googleRows[gi + 1].ts <= t) gi++;
    // Older than 2 h means we have no current Google reading for this point.
    return gi >= 0 && t - googleRows[gi].ts <= 7200 ? googleRows[gi].value : null;
  };

  return [...buckets.keys()]
    .sort((a, b) => a - b)
    .map((k) => {
      const end = k + bucket; // compare a bucket against the rate known by its end
      const g = googleAt(Math.min(end, now));
      const { binance, bybit } = buckets.get(k)!;
      return {
        t: k * 1000,
        google: g,
        binance,
        bybit,
        binancePremium: prem(binance, g),
        bybitPremium: prem(bybit, g),
      };
    });
}
