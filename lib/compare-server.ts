import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { listMarketSnapshots, rangeSinceSeconds, RANGES, type RangeKey } from "@/lib/db/queries";
import { getBook } from "@/lib/market-data";
import { EXCHANGE_IDS, EXCHANGES, UpstreamError, type ExchangeId } from "@/lib/exchanges";
import { ASSET, FIAT } from "@/lib/constants";
import {
  mergeSpreadSeries,
  type BooksPayload,
  type ComparePayload,
  type LiveBook,
  type LiveBooks,
  type ShareNow,
  type SharePoint,
} from "@/lib/compare";

/** Ranges offered on the compare page. */
export const COMPARE_RANGES = ["6h", "24h", "7d", "30d"] as const satisfies readonly RangeKey[];
export type CompareRange = (typeof COMPARE_RANGES)[number];

export function parseCompareRange(v: unknown): CompareRange {
  return typeof v === "string" && (COMPARE_RANGES as readonly string[]).includes(v)
    ? (v as CompareRange)
    : "24h";
}

/* ── Live books ────────────────────────────────────────────────────────── */

async function loadOne(ex: ExchangeId): Promise<LiveBook> {
  const adapter = EXCHANGES[ex];
  const base = { exchange: ex, label: adapter.label, payTypes: adapter.bankPayTypes };
  try {
    // Unfiltered query → served from the cron-maintained KV copy.
    const book = await getBook(ex, { asset: ASSET, fiat: FIAT.code });
    return { ...base, ok: true, ts: book.ts, source: book.source, buy: book.buy, sell: book.sell };
  } catch (err) {
    if (!(err instanceof UpstreamError)) console.error(err);
    return {
      ...base,
      ok: false,
      error:
        err instanceof UpstreamError
          ? `${adapter.label} is not responding right now.`
          : "Couldn't load this book.",
    };
  }
}

/** Both exchanges' books in parallel. Never throws: a failed exchange comes
 *  back as `{ ok: false }` so the other one still renders. */
export async function loadLiveBooks(): Promise<LiveBooks> {
  const list = await Promise.all(EXCHANGE_IDS.map(loadOne));
  return Object.fromEntries(list.map((b) => [b.exchange, b])) as LiveBooks;
}

export async function loadBooksPayload(): Promise<BooksPayload> {
  return { books: await loadLiveBooks(), generatedAt: Date.now() };
}

/* ── Market share (from merchant sweeps) ──────────────────────────────── */

/** Chart bucket per range for the share series. */
const SHARE_BUCKET: Record<CompareRange, number> = {
  "6h": 300,
  "24h": 1800,
  "7d": 3 * 3600,
  "30d": 12 * 3600,
};

type ShareRow = { exchange: ExchangeId; ts: number; ads: number | null; vol: number | null };

/**
 * Share inputs per exchange over time:
 *  - ads: listed LKR ads from the merchant sweeps (raw 5-min ≤ 24h, hourly
 *    rollups beyond);
 *  - vol: NEAR-TOUCH LKR depth — both sides within 1 % of their best price,
 *    online & unrestricted ads (market_snapshots / market_hourly). The old
 *    "total listed LKR" was dominated by far-off, unbacked bids
 *    (DATA-AUDIT F4), so it no longer drives the share.
 */
async function shareRows(range: CompareRange): Promise<ShareRow[]> {
  const db = await getDb();
  const since = rangeSinceSeconds(range);
  const short = RANGES[range] <= RANGES["24h"];
  const m = schema.merchantSnapshots;
  const h = schema.merchantHourly;
  const ms = schema.marketSnapshots;
  const mh = schema.marketHourly;
  const [adsRows, volRows] = await Promise.all([
    short
      ? db
          .select({ exchange: m.exchange, ts: m.ts, ads: sql<number>`sum(coalesce(${m.buyAds}, 0) + coalesce(${m.sellAds}, 0))` })
          .from(m)
          .where(and(eq(m.asset, ASSET), eq(m.fiat, FIAT.code), gte(m.ts, since)))
          .groupBy(m.exchange, m.ts)
      : db
          .select({ exchange: h.exchange, ts: h.hourTs, ads: sql<number>`sum(coalesce(${h.maxBuyAds}, 0) + coalesce(${h.maxSellAds}, 0))` })
          .from(h)
          .where(and(eq(h.asset, ASSET), eq(h.fiat, FIAT.code), gte(h.hourTs, since - (since % 3600))))
          .groupBy(h.exchange, h.hourTs),
    RANGES[range] <= 14 * 86400
      ? db
          .select({ exchange: ms.exchange, ts: ms.ts, vol: sql<number | null>`${ms.bidDepth1Fiat} + ${ms.askDepth1Fiat}` })
          .from(ms)
          .where(and(eq(ms.asset, ASSET), eq(ms.fiat, FIAT.code), gte(ms.ts, since)))
      : db
          .select({ exchange: mh.exchange, ts: mh.hourTs, vol: sql<number | null>`${mh.bidDepth1Fiat} + ${mh.askDepth1Fiat}` })
          .from(mh)
          .where(and(eq(mh.asset, ASSET), eq(mh.fiat, FIAT.code), gte(mh.hourTs, since - (since % 3600)))),
  ]);
  return [
    ...adsRows.map((r) => ({ exchange: r.exchange, ts: r.ts, ads: Number(r.ads), vol: null })),
    ...volRows.map((r) => ({ exchange: r.exchange, ts: r.ts, ads: null, vol: r.vol == null ? null : Number(r.vol) })),
  ];
}

/** Latest sweep (ads) and latest market snapshot (near-touch LKR) per exchange. */
async function shareNow(): Promise<ShareNow> {
  const db = await getDb();
  const m = schema.merchantSnapshots;
  const ms = schema.marketSnapshots;
  const since = Math.floor(Date.now() / 1000) - 3 * 3600;
  const [adsRows, volRows] = await Promise.all([
    db
      .select({ exchange: m.exchange, ts: m.ts, ads: sql<number>`sum(coalesce(${m.buyAds}, 0) + coalesce(${m.sellAds}, 0))` })
      .from(m)
      .where(
        and(
          eq(m.asset, ASSET),
          eq(m.fiat, FIAT.code),
          gte(m.ts, since),
          sql`${m.ts} = (select max(s2.ts) from merchant_snapshots s2 where s2.exchange = ${m.exchange} and s2.asset = ${m.asset} and s2.fiat = ${m.fiat})`,
        ),
      )
      .groupBy(m.exchange, m.ts),
    db
      .select({ exchange: ms.exchange, ts: ms.ts, vol: sql<number | null>`${ms.bidDepth1Fiat} + ${ms.askDepth1Fiat}` })
      .from(ms)
      .where(
        and(
          eq(ms.asset, ASSET),
          eq(ms.fiat, FIAT.code),
          gte(ms.ts, since),
          sql`${ms.ts} = (select max(s3.ts) from market_snapshots s3 where s3.exchange = ${ms.exchange} and s3.asset = ${ms.asset} and s3.fiat = ${ms.fiat})`,
        ),
      ),
  ]);
  const ads = (ex: ExchangeId) => adsRows.find((r) => r.exchange === ex);
  const vol = (ex: ExchangeId) => volRows.find((r) => r.exchange === ex);
  const bn = ads("binance");
  const by = ads("bybit");
  if (!bn || !by) return null;
  const n = (v: unknown) => (v == null ? 0 : Number(v));
  return {
    ts: Math.max(bn.ts, by.ts, vol("binance")?.ts ?? 0, vol("bybit")?.ts ?? 0),
    binanceAds: Number(bn.ads),
    bybitAds: Number(by.ads),
    binanceVol: n(vol("binance")?.vol),
    bybitVol: n(vol("bybit")?.vol),
  };
}

function bucketShare(rows: ShareRow[], bucket: number): SharePoint[] {
  type Acc = { ads: number; nAds: number; vol: number; nVol: number };
  const map = new Map<number, Partial<Record<ExchangeId, Acc>>>();
  for (const r of rows) {
    const b = Math.floor(r.ts / bucket) * bucket;
    let slot = map.get(b);
    if (!slot) map.set(b, (slot = {}));
    const acc = (slot[r.exchange] ??= { ads: 0, nAds: 0, vol: 0, nVol: 0 });
    if (r.ads != null) {
      acc.ads += r.ads;
      acc.nAds += 1;
    }
    if (r.vol != null && Number.isFinite(r.vol)) {
      acc.vol += r.vol;
      acc.nVol += 1;
    }
  }
  const avgAds = (a: Acc | undefined) => (a && a.nAds ? a.ads / a.nAds : null);
  const avgVol = (a: Acc | undefined) => (a && a.nVol ? a.vol / a.nVol : null);
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ts, s]) => ({
      t: ts * 1000,
      binanceAds: avgAds(s.binance),
      bybitAds: avgAds(s.bybit),
      binanceVol: avgVol(s.binance),
      bybitVol: avgVol(s.bybit),
    }));
}

/* ── Everything the compare page needs ─────────────────────────────────── */

export async function loadComparePayload(range: CompareRange): Promise<ComparePayload> {
  const [books, bnHist, byHist, rows, now] = await Promise.all([
    loadLiveBooks(),
    listMarketSnapshots("binance", ASSET, FIAT.code, range).catch(() => []),
    listMarketSnapshots("bybit", ASSET, FIAT.code, range).catch(() => []),
    shareRows(range).catch((err) => {
      console.error(err);
      return [] as ShareRow[];
    }),
    shareNow().catch((err) => {
      console.error(err);
      return null;
    }),
  ]);
  return {
    range,
    books,
    spread: mergeSpreadSeries(bnHist, byHist),
    share: { series: bucketShare(rows, SHARE_BUCKET[range]), now },
    generatedAt: Date.now(),
  };
}
