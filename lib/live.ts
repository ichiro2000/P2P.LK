import type { NormalizedAd } from "@/lib/types";
import type { ExchangeId } from "@/lib/exchanges";

/**
 * Hot "latest book" cache in Workers KV. The cron writes it every minute;
 * pages read it instead of calling Binance/Bybit on the request path, so a
 * page render never waits on an exchange.
 */

/** "all" = every publisher; "merchant" = verified merchants only (the
 *  default view on the markets page). Both are cached so neither waits. */
export type BookVariant = "all" | "merchant";

export type LiveBook = {
  exchange: ExchangeId;
  variant: BookVariant;
  asset: string;
  fiat: string;
  /** Unix seconds when the book was captured. */
  ts: number;
  buy: NormalizedAd[];
  sell: NormalizedAd[];
};

/** Ads per side the cron keeps in the "all" variant (the "merchant" variant
 *  keeps 20). Readers slice to what they need; getBook() defaults to 20. */
export const LIVE_DEEP_N = 100;

/** Books older than this are treated as missing (cron stalled). */
export const LIVE_MAX_AGE_SEC = 5 * 60;

const key = (ex: ExchangeId, variant: BookVariant, asset: string, fiat: string) =>
  `book:${ex}:${variant}:${asset}:${fiat}`;

export async function putLiveBook(kv: KVNamespace, book: LiveBook) {
  // KV TTL floor is 60s; keep an hour so a stalled cron degrades to "stale"
  // rather than "empty".
  await kv.put(key(book.exchange, book.variant, book.asset, book.fiat), JSON.stringify(book), {
    expirationTtl: 3600,
  });
}

export async function getLiveBook(
  kv: KVNamespace,
  ex: ExchangeId,
  variant: BookVariant,
  asset: string,
  fiat: string,
): Promise<LiveBook | null> {
  // cacheTtl lets the edge serve repeat reads from local cache for 30s
  // (minimum KV allows), which is what makes the read effectively free.
  const book = await kv.get<LiveBook>(key(ex, variant, asset, fiat), {
    type: "json",
    cacheTtl: 30,
  });
  if (!book) return null;
  const age = Math.floor(Date.now() / 1000) - book.ts;
  return age <= LIVE_MAX_AGE_SEC ? book : null;
}
