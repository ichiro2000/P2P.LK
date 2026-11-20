import { getEnv } from "@/lib/db/client";
import { getExchange, type Book, type BookQuery, type ExchangeId } from "@/lib/exchanges";
import { getLiveBook, type BookVariant } from "@/lib/live";

export type BookResult = Book & {
  /** Unix seconds the book was captured. */
  ts: number;
  /** "cache" = served from the cron-maintained KV copy (no upstream call). */
  source: "cache" | "live";
};

/** Which cached variant (if any) can answer this query exactly. */
function cachedVariant(ex: ExchangeId, q: BookQuery): BookVariant | null {
  if (q.transAmount) return null;
  const all = getExchange(ex).bankPayTypes.map((p) => p.id).sort().join(",");
  const asked = (q.payTypes ?? []).slice().sort().join(",");
  if (asked !== "" && asked !== all) return null;
  return q.publisherType === "merchant" ? "merchant" : "all";
}

/** True when the query is answered from the cron-maintained KV copy (no
 *  upstream call). Routes use it to rate-limit live queries harder. */
export const isCachedQuery = (ex: ExchangeId, q: BookQuery) => cachedVariant(ex, q) != null;

/**
 * The one way pages and APIs read an order book.
 * Unfiltered views come straight from KV (written every minute by the cron),
 * so they never wait on Binance/Bybit. Filtered views, or a stale/missing KV
 * entry, fall back to a live upstream call. Upstream failures throw
 * `UpstreamError` — callers show an error, never a fake empty market.
 */
export async function getBook(ex: ExchangeId, q: BookQuery, rows = 20): Promise<BookResult> {
  const variant = cachedVariant(ex, q);
  if (variant) {
    const env = await getEnv();
    const cached = await getLiveBook(env.LIVE, ex, variant, q.asset, q.fiat);
    if (cached) {
      return {
        buy: cached.buy.slice(0, rows),
        sell: cached.sell.slice(0, rows),
        ts: cached.ts,
        source: "cache",
      };
    }
  }
  return liveBook(ex, q, rows);
}

/**
 * Filtered books are fetched live, so every distinct query is an upstream
 * call. Share each one for a few seconds (and while it's in flight) so many
 * viewers — or one client looping over filters — can't turn our traffic into
 * a flood against Binance/Bybit that gets the egress IPs blocked.
 */
const LIVE_TTL_MS = 15_000;
const LIVE_MAX = 200;
const LIVE = Symbol.for("p2plk.market.live");
type LiveEntry = { at: number; p: Promise<BookResult> };
const liveStore = globalThis as unknown as Record<symbol, Map<string, LiveEntry> | undefined>;

function liveBook(ex: ExchangeId, q: BookQuery, rows: number): Promise<BookResult> {
  const cache = (liveStore[LIVE] ??= new Map());
  const key = JSON.stringify([ex, q.asset, q.fiat, (q.payTypes ?? []).slice().sort(), q.publisherType ?? null, q.transAmount ?? null, rows]);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < LIVE_TTL_MS) return hit.p;
  const adapter = getExchange(ex);
  const p = adapter
    .fetchBook({ ...q, payTypes: q.payTypes?.length ? q.payTypes : adapter.bankPayTypes.map((p) => p.id) }, { rows })
    .then((book): BookResult => ({ ...book, ts: Math.floor(Date.now() / 1000), source: "live" }));
  // Failures aren't cached: the next caller retries.
  p.catch(() => cache.delete(key));
  cache.delete(key);
  cache.set(key, { at: now, p });
  while (cache.size > LIVE_MAX) cache.delete(cache.keys().next().value!);
  return p;
}
