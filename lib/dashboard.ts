import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { buildMarket } from "@/lib/analytics";
import { ASSET, FIAT } from "@/lib/constants";
import { getDb, schema } from "@/lib/db/client";
import { getMerchant, latestSweepTs, listMarketSnapshots } from "@/lib/db/queries";
import { EXCHANGE_IDS, type ExchangeId } from "@/lib/exchanges";
import { getBook } from "@/lib/market-data";
import { LIVE_DEEP_N } from "@/lib/live";
import { downsampleMinMax } from "@/lib/stats";
import { listEvents, listItems, unreadCount } from "@/lib/member-data";
import { deriveMerchantTier, type MerchantTier } from "@/lib/merchant-tier";
import { reliabilityScore } from "@/lib/merchant-score";
import { reliabilityInputs, twoSidedPrices } from "@/lib/db/merchant-directory";
import { medianOwnSpread, type SpreadMedian } from "@/lib/competitors";
import { linkedAdvertisers, type LinkedAdvertiser } from "@/lib/merchant-link";
import type { AlertEventRow } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/session";
import type { NormalizedAd } from "@/lib/types";

/**
 * Everything the member dashboard (/app) shows, read in one parallel pass.
 * Every piece fails soft: a dead upstream or empty table shows an empty
 * state for that card, never a broken page.
 *
 * Side vocabulary (same as the rest of the app):
 *   asks = tradeType "SELL" ads → where you BUY USDT  (best = lowest)
 *   bids = tradeType "BUY"  ads → where you SELL USDT (best = highest)
 */

const MAX_MARKETS = 3;
const MAX_FAVOURITES = 8;
const MAX_FILTERS = 8;
const MAX_EVENTS = 5;
/** A merchant counts as live if seen in the last sweep (or the one before). */
const LIVE_SLACK_SEC = 120;

/* ── Markets ─────────────────────────────────────────────────────────── */

export type MarketTile = {
  exchange: ExchangeId;
  asset: string;
  fiat: string;
  /** Lowest ask: what you pay to buy USDT. */
  buyAt: number | null;
  /** Highest bid: what you get selling USDT. */
  sellAt: number | null;
  spread: number | null;
  spreadPct: number | null;
  /** 24h mid-price series, thinned for a sparkline. */
  spark: (number | null)[];
  /** First → last mid over the spark window. */
  change24h: number | null;
  /** Unix seconds of the book, null when unavailable. */
  ts: number | null;
};

async function marketTile(ex: ExchangeId, asset: string, fiat: string): Promise<MarketTile> {
  const [book, series] = await Promise.all([
    getBook(ex, { asset, fiat, publisherType: "merchant" }).catch(() => null),
    listMarketSnapshots(ex, asset, fiat, "24h").catch(() => []),
  ]);
  const snap = book ? buildMarket(asset, fiat, [...book.buy, ...book.sell]) : null;
  // Same book as the tile's prices (F13): the verified-merchant mid. Recorded
  // from migration 0005 on, so the spark starts short rather than borrowing
  // the all-publishers series.
  const merchantMid = series
    .map((p) => ({
      ts: p.ts,
      mid: p.merchantBestBid != null && p.merchantBestAsk != null ? (p.merchantBestBid + p.merchantBestAsk) / 2 : null,
    }))
    .filter((p) => p.mid != null);
  const mids = downsampleMinMax(merchantMid, 48, (p) => p.mid).map((p) => p.mid);
  const first = mids.find((v) => v != null) ?? null;
  const last = [...mids].reverse().find((v) => v != null) ?? null;
  return {
    exchange: ex,
    asset,
    fiat,
    buyAt: snap?.sell.bestPrice ?? null,
    sellAt: snap?.buy.bestPrice ?? null,
    spread: snap?.spread ?? null,
    spreadPct: snap?.spreadPct ?? null,
    spark: mids,
    // Only a real 24h change: the merchant series must reach back ~a day.
    change24h:
      first != null && last != null && first > 0 && (merchantMid[0]?.ts ?? Infinity) <= Date.now() / 1000 - 20 * 3600
        ? (last - first) / first
        : null,
    ts: book?.ts ?? null,
  };
}

/* ── The member's own merchant ───────────────────────────────────────── */

/** `capped` = the cached book stopped at LIVE_DEEP_N ads, so `of` is "N+". */
export type BookRank = {
  position: number;
  of: number;
  capped: boolean;
  price: number;
  best: number | null;
  diff: number | null;
} | null;

export type OwnMerchant =
  | { status: "found"; exchange: ExchangeId; id: string; name: string; live: boolean; lastSeenTs: number;
      tier: MerchantTier | null; completionRate: number | null; orders30d: number | null; avgReleaseSec: number | null;
      trustScore: number;
      /** Their best ad among asks (they sell USDT) and bids (they buy USDT). */
      ask: BookRank; bid: BookRank;
      /** Last known prices when they aren't on the book right now. */
      lastAsk: number | null; lastBid: number | null;
      /** Ads per side the rank was searched in; equal to `cap` = the book is
       *  deeper than what's cached, so "not found" means "below the top cap". */
      scanned: { ask: number; bid: number; cap: number; listsAsk: boolean; listsBid: boolean } | null;
      marketAsk: number | null; marketBid: number | null;
      /** Median own spread among two-sided merchants listing now. */
      spreadMedian: SpreadMedian | null }
  | { status: "missing"; exchange: ExchangeId; id: string };

/** Reliability score (D7) — the shared implementation in `lib/merchant-score.ts`. */
async function ownReliability(ex: ExchangeId, row: { merchantId: string; completionRate: number | null; ordersMonth: number | null; firstSeenTs: number }) {
  const inputs = await reliabilityInputs(ex, ASSET, FIAT.code, [row.merchantId]).catch(() => null);
  const r = inputs?.get(row.merchantId);
  return reliabilityScore({
    completionRate: row.completionRate,
    orders30d: row.ordersMonth,
    presence7d: r?.presence7d ?? null,
    firstSeenTs: r?.firstSeenTs ?? row.firstSeenTs,
    avgReleaseSec: r?.avgReleaseSec ?? null,
    positive: r?.positive ?? null,
    negative: r?.negative ?? null,
    registerDays: r?.registerDays ?? null,
  }).score;
}

export function rankOn(ads: NormalizedAd[], id: string, side: "ask" | "bid"): BookRank {
  if (!ads.length) return null;
  const i = ads.findIndex((a) => a.merchant.id === id);
  if (i < 0) return null;
  const prices = ads.map((a) => a.price);
  const best = side === "ask" ? Math.min(...prices) : Math.max(...prices);
  const price = ads[i].price;
  // Positive diff = worse than best for the counterparty (ask above / bid below).
  const diff = side === "ask" ? price - best : best - price;
  return { position: i + 1, of: ads.length, capped: ads.length >= LIVE_DEEP_N, price, best, diff };
}

async function ownMerchant(link: LinkedAdvertiser): Promise<OwnMerchant> {
  const { exchange: ex, id } = link;
  const [row, book, sweepTs, twoSided] = await Promise.all([
    getMerchant(ex, id, ASSET, FIAT.code).catch(() => undefined),
    // Full book (merchants and users) so the position is their real place.
    // The cron caches LIVE_DEEP_N ads per side (F15), so ranks go past 20.
    getBook(ex, { asset: ASSET, fiat: FIAT.code, publisherType: null }, LIVE_DEEP_N).catch(() => null),
    latestSweepTs(ex, ASSET, FIAT.code).catch(() => null),
    twoSidedPrices(ex, ASSET, FIAT.code).catch(() => []),
  ]);
  if (!row) return { status: "missing", exchange: ex, id };
  const live = sweepTs != null && row.lastSeenTs >= sweepTs - LIVE_SLACK_SEC;
  const snap = book ? buildMarket(ASSET, FIAT.code, [...book.buy, ...book.sell]) : null;
  return {
    status: "found",
    exchange: ex,
    id,
    name: row.merchantName,
    live,
    lastSeenTs: row.lastSeenTs,
    tier: deriveMerchantTier({ isMerchant: row.isMerchant, userIdentity: row.userIdentity, vipLevel: row.vipLevel }),
    completionRate: row.completionRate,
    orders30d: row.ordersMonth,
    avgReleaseSec: row.avgReleaseSec,
    trustScore: await ownReliability(ex, row),
    ask: book ? rankOn(book.sell, id, "ask") : null,
    bid: book ? rankOn(book.buy, id, "bid") : null,
    lastAsk: row.bestSellPrice,
    lastBid: row.bestBuyPrice,
    scanned: book
      ? {
          ask: book.sell.length,
          bid: book.buy.length,
          cap: LIVE_DEEP_N,
          listsAsk: (row.sellAds ?? 0) > 0,
          listsBid: (row.buyAds ?? 0) > 0,
        }
      : null,
    marketAsk: snap?.sell.bestPrice ?? null,
    marketBid: snap?.buy.bestPrice ?? null,
    spreadMedian: medianOwnSpread(twoSided),
  };
}

/* ── Favourite merchants ─────────────────────────────────────────────── */

export type FavouriteMerchant = {
  exchange: ExchangeId;
  id: string;
  name: string;
  live: boolean | null;
  completionRate: number | null;
  orders30d: number | null;
  tier: MerchantTier | null;
};

async function favouriteMerchants(userId: string): Promise<{ items: FavouriteMerchant[]; total: number }> {
  const items = await listItems(userId, "merchant");
  const picked = items
    .map((it) => {
      const d = it.data as { exchange?: string; id?: string; name?: string };
      const [kEx, ...rest] = it.itemKey.split(":");
      const exchange = (EXCHANGE_IDS as readonly string[]).includes(d.exchange ?? kEx)
        ? ((d.exchange ?? kEx) as ExchangeId)
        : null;
      const id = String(d.id ?? rest.join(":"));
      return exchange && id ? { exchange, id, name: String(d.name ?? id) } : null;
    })
    .filter((x): x is { exchange: ExchangeId; id: string; name: string } => !!x)
    .slice(0, MAX_FAVOURITES);
  if (!picked.length) return { items: [], total: items.length };

  const db = await getDb();
  const byEx = await Promise.all(
    EXCHANGE_IDS.map(async (ex) => {
      const ids = picked.filter((p) => p.exchange === ex).map((p) => p.id);
      if (!ids.length) return [ex, null, []] as const;
      const m = schema.merchants;
      const [sweep, rows] = await Promise.all([
        latestSweepTs(ex, ASSET, FIAT.code).catch(() => null),
        db
          .select()
          .from(m)
          .where(and(eq(m.exchange, ex), eq(m.asset, ASSET), eq(m.fiat, FIAT.code), inArray(m.merchantId, ids)))
          .catch(() => []),
      ]);
      return [ex, sweep, rows] as const;
    }),
  );
  const lookup = new Map<string, { sweep: number | null; row: (typeof byEx)[number][2][number] }>();
  for (const [ex, sweep, rows] of byEx) for (const r of rows) lookup.set(`${ex}:${r.merchantId}`, { sweep, row: r });

  return {
    total: items.length,
    items: picked.map((p) => {
      const hit = lookup.get(`${p.exchange}:${p.id}`);
      const r = hit?.row;
      return {
        ...p,
        name: r?.merchantName ?? p.name,
        live: r && hit?.sweep != null ? r.lastSeenTs >= hit.sweep - LIVE_SLACK_SEC : r ? false : null,
        completionRate: r?.completionRate ?? null,
        orders30d: r?.ordersMonth ?? null,
        tier: r ? deriveMerchantTier({ isMerchant: r.isMerchant, userIdentity: r.userIdentity, vipLevel: r.vipLevel }) : null,
      };
    }),
  };
}

/* ── Saved filters ───────────────────────────────────────────────────── */

export type SavedFilter = { key: string; label: string; href: string };

async function savedFilters(userId: string): Promise<{ items: SavedFilter[]; total: number }> {
  const items = await listItems(userId, "filter");
  const out: SavedFilter[] = [];
  for (const it of items) {
    const d = it.data as { label?: string; path?: string; search?: string };
    const path = String(d.path ?? "");
    // Internal paths only.
    if (!path.startsWith("/") || path.startsWith("//")) continue;
    const search = String(d.search ?? "").replace(/^\?/, "");
    out.push({ key: it.itemKey, label: String(d.label ?? path), href: search ? `${path}?${search}` : path });
    if (out.length >= MAX_FILTERS) break;
  }
  return { items: out, total: items.length };
}

/* ── All of it ───────────────────────────────────────────────────────── */

export type DashboardData = {
  markets: MarketTile[];
  /** True when the member hasn't starred a market (showing the default). */
  defaultMarkets: boolean;
  links: LinkedAdvertiser[];
  own: OwnMerchant[];
  favourites: { items: FavouriteMerchant[]; total: number };
  filters: { items: SavedFilter[]; total: number };
  events: AlertEventRow[];
  unread: number;
};

export async function loadDashboard(viewer: Viewer): Promise<DashboardData> {
  const links = linkedAdvertisers(viewer);
  // Start everything that doesn't depend on the watchlist right away.
  const rest = Promise.all([
    Promise.all(links.map(ownMerchant)),
    favouriteMerchants(viewer.id).catch(() => ({ items: [], total: 0 })),
    savedFilters(viewer.id).catch(() => ({ items: [], total: 0 })),
    listEvents(viewer.id, MAX_EVENTS).catch(() => []),
    unreadCount(viewer.id).catch(() => 0),
  ]);

  const marketItems = await listItems(viewer.id, "market").catch(() => []);
  const seen = new Set<string>();
  const pairs: { asset: string; fiat: string }[] = [];
  for (const it of marketItems) {
    const d = it.data as { asset?: string; fiat?: string };
    if (!d.asset || !d.fiat) continue;
    const k = `${d.asset}/${d.fiat}`;
    if (seen.has(k)) continue;
    seen.add(k);
    pairs.push({ asset: String(d.asset), fiat: String(d.fiat) });
    if (pairs.length >= MAX_MARKETS) break;
  }
  const defaultMarkets = pairs.length === 0;
  const watch = defaultMarkets ? [{ asset: ASSET, fiat: FIAT.code }] : pairs;

  const [markets, [own, favourites, filters, events, unread]] = await Promise.all([
    Promise.all(watch.flatMap((p) => EXCHANGE_IDS.map((ex) => marketTile(ex, p.asset, p.fiat)))),
    rest,
  ]);

  return { markets, defaultMarkets, links, own, favourites, filters, events, unread };
}
