/**
 * Binance vs Bybit comparison helpers. Pure and client-safe: the server
 * loaders live in `lib/compare-server.ts`.
 *
 * Vocabulary (same as the rest of the app):
 *   - "SELL" ads (asks) are where a user BUYS USDT → best = lowest price.
 *   - "BUY"  ads (bids) are where a user SELLS USDT → best = highest price.
 */

import { deriveMerchantTier } from "@/lib/merchant-tier";
import { quoteAmount, type AmountQuote, type WalkOptions } from "@/lib/liquidity";
import type { NormalizedAd, TradeType } from "@/lib/types";
import type { ExchangeId, PayTypeOption } from "@/lib/exchanges/types";

/* ── Payload shapes (shared by the page, the API and the client) ───────── */

export type LiveBookOk = {
  exchange: ExchangeId;
  label: string;
  ok: true;
  /** Unix seconds the book was captured. */
  ts: number;
  source: "cache" | "live";
  payTypes: PayTypeOption[];
  buy: NormalizedAd[];
  sell: NormalizedAd[];
};
export type LiveBookErr = {
  exchange: ExchangeId;
  label: string;
  ok: false;
  error: string;
  payTypes: PayTypeOption[];
};
export type LiveBook = LiveBookOk | LiveBookErr;
export type LiveBooks = Record<ExchangeId, LiveBook>;

export type SpreadPoint = {
  /** Epoch ms. */
  t: number;
  binance: number | null;
  bybit: number | null;
  binanceAbs: number | null;
  bybitAbs: number | null;
};

export type SharePoint = {
  /** Epoch ms. */
  t: number;
  binanceAds: number | null;
  bybitAds: number | null;
  binanceVol: number | null;
  bybitVol: number | null;
};

export type ShareNow = {
  ts: number;
  binanceAds: number;
  bybitAds: number;
  binanceVol: number;
  bybitVol: number;
} | null;

export type ComparePayload = {
  range: string;
  books: LiveBooks;
  spread: SpreadPoint[];
  share: { series: SharePoint[]; now: ShareNow };
  generatedAt: number;
};

export type BooksPayload = { books: LiveBooks; generatedAt: number };

/* ── Head to head ──────────────────────────────────────────────────────── */

export type ExchangeSide = {
  /** Best price on the side (lowest ask / highest bid). */
  best: number | null;
  /** Walked price for the requested amount (when one was given). */
  quote?: AmountQuote;
  /** Ads in the cached top-of-book (≤ 20). */
  count: number;
  /** Listed value in LKR across those ads. */
  depthFiat: number;
  /** Listed USDT across those ads. */
  depthAsset: number;
};

export type ExchangeSummary = {
  exchange: ExchangeId;
  label: string;
  ok: boolean;
  /** LKR amount the sides were priced for (null = top of book only). */
  amount: number | null;
  /** Where users buy USDT (sell ads). */
  buyUsdt: ExchangeSide;
  /** Where users sell USDT (buy ads). */
  sellUsdt: ExchangeSide;
  spread: number | null;
  spreadPct: number | null;
  mid: number | null;
};

function sideOf(
  ads: NormalizedAd[],
  tradeType: TradeType,
  amount: number | null,
  opts?: WalkOptions,
): ExchangeSide {
  const prices = ads.map((a) => a.price).filter((p) => p > 0);
  return {
    best: prices.length
      ? tradeType === "SELL"
        ? Math.min(...prices)
        : Math.max(...prices)
      : null,
    ...(amount != null && amount > 0 ? { quote: quoteAmount(ads, tradeType, amount, opts) } : {}),
    count: ads.length,
    depthFiat: ads.reduce((s, a) => s + a.available * a.price, 0),
    depthAsset: ads.reduce((s, a) => s + a.available, 0),
  };
}

/** Per-exchange summary. With `amount` (LKR), each side is also priced by
 *  walking the book for that amount (`lib/liquidity.ts` walkBook). */
export function summarize(book: LiveBook, amount: number | null = null, opts?: WalkOptions): ExchangeSummary {
  const buyAds = book.ok ? book.sell : [];
  const sellAds = book.ok ? book.buy : [];
  const buyUsdt = sideOf(buyAds, "SELL", amount, opts);
  const sellUsdt = sideOf(sellAds, "BUY", amount, opts);
  const spread =
    buyUsdt.best != null && sellUsdt.best != null ? buyUsdt.best - sellUsdt.best : null;
  const mid =
    buyUsdt.best != null && sellUsdt.best != null ? (buyUsdt.best + sellUsdt.best) / 2 : null;
  return {
    exchange: book.exchange,
    label: book.label,
    ok: book.ok,
    amount: amount != null && amount > 0 ? amount : null,
    buyUsdt,
    sellUsdt,
    spread,
    spreadPct: spread != null && mid ? spread / mid : null,
    mid,
  };
}

/**
 * The price a side is judged on: the walked effective price for the
 * summary's amount when the book can fill it in full, else top of book
 * when no amount was given. A book that can't fill the amount gets null
 * (it can't win) unless neither can, then the partial fills are compared.
 */
export function judgedPrice(s: ExchangeSide, amount: number | null, allowPartial = false): number | null {
  if (amount == null) return s.best;
  const q = s.quote;
  if (!q || q.walk.effectivePrice == null) return null;
  if (q.walk.partial && !allowPartial) return null;
  return q.walk.effectivePrice;
}

/** Which exchange is better for buying (lower price) and selling (higher).
 *  With an amount, judged on the walked effective price for that amount.
 *  Null when one side is missing or the prices tie. */
export function verdict(a: ExchangeSummary, b: ExchangeSummary) {
  const amount = a.amount ?? b.amount ?? null;
  const pick = (x: number | null, y: number | null, lowerWins: boolean) => {
    if (!a.ok || !b.ok || (x == null && y == null)) return null;
    // With an amount, a book that can't fill it loses to one that can.
    if (x == null) return amount != null ? b.exchange : null;
    if (y == null) return amount != null ? a.exchange : null;
    if (Math.abs(x - y) < 1e-9) return null;
    return (lowerWins ? x < y : x > y) ? a.exchange : b.exchange;
  };
  const prices = (side: "buyUsdt" | "sellUsdt") => {
    let x = judgedPrice(a[side], amount);
    let y = judgedPrice(b[side], amount);
    // Neither book fills it in full: compare what they can fill.
    if (amount != null && x == null && y == null) {
      x = judgedPrice(a[side], amount, true);
      y = judgedPrice(b[side], amount, true);
    }
    return [x, y] as const;
  };
  const [ab, bb] = prices("buyUsdt");
  const [sa, sb] = prices("sellUsdt");
  const gap = (x: number | null, y: number | null) => (x != null && y != null ? Math.abs(x - y) : null);
  return {
    buy: pick(ab, bb, true),
    sell: pick(sa, sb, false),
    buyGap: gap(ab, bb),
    sellGap: gap(sa, sb),
    /** Price of the winner on each side, as judged. */
    buyPrice: ab != null && bb != null ? Math.min(ab, bb) : (ab ?? bb),
    sellPrice: sa != null && sb != null ? Math.max(sa, sb) : (sa ?? sb),
  };
}

/* ── Pay methods ───────────────────────────────────────────────────────── */

/** Bank rails we query, plus any other method seen on the current book. */
export function payMethodOptions(book: LiveBook): PayTypeOption[] {
  const out = new Map<string, string>();
  for (const p of book.payTypes) out.set(p.id, p.label);
  if (book.ok) {
    for (const a of [...book.buy, ...book.sell]) {
      for (const m of a.payMethods) if (!out.has(m.id)) out.set(m.id, m.name || m.id);
    }
  }
  return [...out].map(([id, label]) => ({ id, label }));
}

export function acceptsMethod(ad: NormalizedAd, payType: string) {
  return !payType || ad.payMethods.some((m) => m.id === payType);
}

/* ── Merchant filters (order-book constructor) ─────────────────────────── */

export type MerchantFilter = {
  verifiedOnly: boolean;
  /** 0..100 */
  minCompletion: number;
  minOrders: number;
};

export const NO_FILTER: MerchantFilter = { verifiedOnly: false, minCompletion: 0, minOrders: 0 };

export function isVerified(ad: NormalizedAd) {
  return (
    deriveMerchantTier({
      isMerchant: ad.merchant.isMerchant,
      userIdentity: ad.merchant.userIdentity,
      vipLevel: ad.merchant.vipLevel,
    }) != null
  );
}

export function passesFilter(ad: NormalizedAd, f: MerchantFilter) {
  if (f.verifiedOnly && !isVerified(ad)) return false;
  if (f.minCompletion > 0 && ad.merchant.completionRate * 100 < f.minCompletion) return false;
  if (f.minOrders > 0 && (ad.merchant.orders30d ?? 0) < f.minOrders) return false;
  return true;
}

export type BookConfig = {
  exchange: ExchangeId;
  /** Ad side: "SELL" = sell ads (you buy USDT), "BUY" = buy ads (you sell). */
  side: TradeType;
  payType: string;
  filter: MerchantFilter;
};

/** The ads a constructor book shows, best price first. */
export function constructBook(books: LiveBooks, cfg: BookConfig): NormalizedAd[] {
  const book = books[cfg.exchange];
  if (!book?.ok) return [];
  const ads = cfg.side === "SELL" ? book.sell : book.buy;
  return ads
    .filter((a) => acceptsMethod(a, cfg.payType) && passesFilter(a, cfg.filter))
    .sort((a, b) => (cfg.side === "SELL" ? a.price - b.price : b.price - a.price));
}

/** Spread from price `a` to price `b`: absolute and as a fraction of `a`. */
export function spreadBetween(a: number, b: number) {
  const abs = b - a;
  return { abs, pct: a > 0 ? abs / a : null };
}

/* ── History merging ───────────────────────────────────────────────────── */

type SpreadIn = { ts: number; spread: number | null; spreadPct: number | null };

/** Merge two per-exchange spread series on their timestamps. Both come from
 *  the same bucket grid (same cron tick / same bucket size), so an exact join
 *  is right; a point missing on one side is left null. */
export function mergeSpreadSeries(binance: SpreadIn[], bybit: SpreadIn[]): SpreadPoint[] {
  const map = new Map<number, SpreadPoint>();
  const row = (ts: number) => {
    let r = map.get(ts);
    if (!r) {
      r = { t: ts * 1000, binance: null, bybit: null, binanceAbs: null, bybitAbs: null };
      map.set(ts, r);
    }
    return r;
  };
  for (const p of binance) {
    const r = row(p.ts);
    r.binance = p.spreadPct;
    r.binanceAbs = p.spread;
  }
  for (const p of bybit) {
    const r = row(p.ts);
    r.bybit = p.spreadPct;
    r.bybitAbs = p.spread;
  }
  return [...map.values()].sort((a, b) => a.t - b.t);
}

/** Binance's share (0..1) of a two-exchange total; null if unknown. */
export function shareOf(a: number | null, b: number | null) {
  if (a == null || b == null) return null;
  const total = a + b;
  return total > 0 ? a / total : null;
}
