/**
 * BTC/USDT spot price, used to show Bitcoin in LKR through the live
 * USDT/LKR P2P book: BTC/LKR = BTC/USDT × USDT/LKR. The spot leg comes from
 * public market-data endpoints, tried in order (Binance's main API blocks
 * some cloud egress, so it is not the only source).
 */

export type BtcSpot = {
  /** Last traded BTC price in USDT. */
  price: number;
  /** 24 h change as a fraction (0.012 = +1.2 %), null when the source has none. */
  change24h: number | null;
  /** 24 h high / low in USDT, null when the source has none. */
  high24h: number | null;
  low24h: number | null;
  source: string;
  /** Unix ms when we fetched it. */
  ts: number;
};

type Parsed = { price: number; change24h: number | null; high24h: number | null; low24h: number | null };
type Source = { name: string; url: string; parse: (j: unknown) => Parsed };

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/** BTC has not traded outside this band; anything else is a broken response. */
export function plausibleBtc(p: number | null): p is number {
  return p != null && p > 1_000 && p < 10_000_000;
}

function need(p: number | null): number {
  if (!plausibleBtc(p)) throw new Error("implausible BTC price");
  return p;
}

export const BTC_SOURCES: Source[] = [
  {
    name: "Binance",
    url: "https://data-api.binance.vision/api/v3/ticker/24hr?symbol=BTCUSDT",
    parse: (j) => {
      const o = j as { lastPrice?: string; priceChangePercent?: string; highPrice?: string; lowPrice?: string };
      const pct = num(o.priceChangePercent);
      return {
        price: need(num(o.lastPrice)),
        change24h: pct == null ? null : pct / 100,
        high24h: num(o.highPrice),
        low24h: num(o.lowPrice),
      };
    },
  },
  {
    name: "Bybit",
    url: "https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT",
    parse: (j) => {
      const t = (
        j as {
          result?: { list?: { lastPrice?: string; price24hPcnt?: string; highPrice24h?: string; lowPrice24h?: string }[] };
        }
      ).result?.list?.[0];
      return {
        price: need(num(t?.lastPrice)),
        change24h: num(t?.price24hPcnt),
        high24h: num(t?.highPrice24h),
        low24h: num(t?.lowPrice24h),
      };
    },
  },
  {
    name: "OKX",
    url: "https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT",
    parse: (j) => {
      const t = (j as { data?: { last?: string; open24h?: string; high24h?: string; low24h?: string }[] }).data?.[0];
      const last = need(num(t?.last));
      const open = num(t?.open24h);
      return {
        price: last,
        change24h: open && open > 0 ? last / open - 1 : null,
        high24h: num(t?.high24h),
        low24h: num(t?.low24h),
      };
    },
  },
];

let cache: BtcSpot | null = null;
const TTL_MS = 15_000;

/** BTC/USDT from the first source that answers sensibly, cached 15 s per isolate. */
export async function getBtcSpot(now = Date.now()): Promise<BtcSpot> {
  if (cache && now - cache.ts < TTL_MS) return cache;
  const errors: string[] = [];
  for (const s of BTC_SOURCES) {
    try {
      const res = await fetch(s.url, {
        headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; P2P.LK)" },
        signal: AbortSignal.timeout(4_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      cache = { ...s.parse(await res.json()), source: s.name, ts: now };
      return cache;
    } catch (e) {
      errors.push(`${s.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // Serve a stale value for up to 5 minutes rather than nothing.
  if (cache && now - cache.ts < 5 * 60_000) return cache;
  throw new Error(`BTC price unavailable (${errors.join("; ")})`);
}

/**
 * BTC in LKR through the USDT book. `usdtNow`/`usdtThen` are USDT/LKR
 * prices; the LKR 24 h change compounds the BTC move and the USDT move.
 */
export function btcInLkr(
  spot: Pick<BtcSpot, "price" | "change24h">,
  usdtNow: number | null,
  usdtThen: number | null = null,
) {
  const lkr = usdtNow != null ? spot.price * usdtNow : null;
  const usdtChange = usdtNow != null && usdtThen != null && usdtThen > 0 ? usdtNow / usdtThen - 1 : null;
  const lkrChange =
    spot.change24h != null && usdtChange != null ? (1 + spot.change24h) * (1 + usdtChange) - 1 : null;
  return { lkr, usdtChange, lkrChange };
}

/* ── 24 h history (15-minute closes) ─────────────────────────────────── */

export type BtcPoint = { t: number; price: number };

type Row = (string | number)[];
const rows = (list: unknown): BtcPoint[] =>
  (Array.isArray(list) ? (list as Row[]) : [])
    .map((r) => ({ t: Number(r[0]), price: Number(r[4]) }))
    .filter((p) => Number.isFinite(p.t) && plausibleBtc(p.price))
    .sort((a, b) => a.t - b.t);

export const BTC_HISTORY_SOURCES: { name: string; url: string; parse: (j: unknown) => BtcPoint[] }[] = [
  {
    name: "Binance",
    url: "https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=96",
    parse: (j) => rows(j),
  },
  {
    name: "Bybit",
    url: "https://api.bybit.com/v5/market/kline?category=spot&symbol=BTCUSDT&interval=15&limit=96",
    parse: (j) => rows((j as { result?: { list?: unknown } }).result?.list),
  },
  {
    name: "OKX",
    url: "https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=15m&limit=96",
    parse: (j) => rows((j as { data?: unknown }).data),
  },
];

let histCache: { points: BtcPoint[]; source: string; ts: number } | null = null;

/** Last 24 h of BTC/USDT 15-minute closes, oldest first, cached 5 min. */
export async function getBtcHistory(now = Date.now()) {
  if (histCache && now - histCache.ts < 5 * 60_000) return histCache;
  for (const s of BTC_HISTORY_SOURCES) {
    try {
      const res = await fetch(s.url, {
        headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; P2P.LK)" },
        signal: AbortSignal.timeout(4_000),
      });
      if (!res.ok) continue;
      const points = s.parse(await res.json());
      if (points.length < 2) continue;
      histCache = { points, source: s.name, ts: now };
      return histCache;
    } catch {
      /* next source */
    }
  }
  if (histCache) return histCache;
  throw new Error("BTC history unavailable");
}

/** Test hook. */
export function _resetBtcCache() {
  cache = null;
  histCache = null;
}
