import type {
  BybitItem,
  BybitSearchResponse,
  NormalizedAd,
  SearchFilters,
  TradeType,
} from "./types";

const BYBIT_P2P_ENDPOINT = "https://api2.bybit.com/fiat/otc/item/online";

/** Seconds of ISR caching for raw market calls. */
export const P2P_REVALIDATE = 20;

/**
 * Map our TradeType vocabulary to Bybit's `side` query param.
 *
 * App vocabulary follows Binance's `adv.tradeType` — the *publisher's* direction:
 *   - tradeType BUY  → publisher wants to buy the asset → bid → our `buy` book side
 *   - tradeType SELL → publisher wants to sell the asset → ask → our `sell` book side
 *
 * Bybit's API is more direct than Binance: query `side=0` returns publisher-buys
 * ads (bids), and `side=1` returns publisher-sells ads (asks). No inversion.
 */
function tradeTypeToSide(tt: TradeType): "0" | "1" {
  return tt === "BUY" ? "0" : "1";
}

function sideToTradeType(side: number | string | undefined): TradeType {
  return String(side) === "0" ? "BUY" : "SELL";
}

/**
 * Fetch one side (BUY or SELL) of a single market from Bybit P2P.
 * Throws on network or non-200 response. Caller decides how to degrade.
 */
export async function fetchBybitP2P(
  filters: SearchFilters,
  opts?: { revalidate?: number; signal?: AbortSignal },
): Promise<BybitItem[]> {
  const body = {
    userId: 0,
    tokenId: filters.asset,
    currencyId: filters.fiat,
    payment: filters.payTypes?.length ? filters.payTypes : [],
    side: tradeTypeToSide(filters.tradeType),
    size: String(filters.rows ?? 20),
    page: String(filters.page ?? 1),
    amount: filters.transAmount ?? "",
    authMaker: false,
    canTrade: false,
  };

  const res = await fetch(BYBIT_P2P_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      // Bybit returns Cloudflare challenge if UA looks scripted.
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Origin: "https://www.bybit.com",
      Referer: "https://www.bybit.com/",
    },
    body: JSON.stringify(body),
    signal: opts?.signal,
    next: { revalidate: opts?.revalidate ?? P2P_REVALIDATE },
  });

  if (!res.ok) {
    throw new Error(
      `Bybit P2P responded ${res.status} for ${filters.asset}/${filters.fiat} ${filters.tradeType}`,
    );
  }

  const json = (await res.json()) as BybitSearchResponse;
  if (!json || json.ret_code !== 0 || !json.result || !Array.isArray(json.result.items)) {
    return [];
  }
  return json.result.items;
}

/** Fetch both book sides in parallel.
 *  Bybit semantics are direct: query side=0 → bids, side=1 → asks.
 *  Returns:
 *    - buy: bids   (publishers buying USDT)
 *    - sell: asks  (publishers selling USDT)
 */
export async function fetchBothSides(
  filters: Omit<SearchFilters, "tradeType">,
  opts?: { revalidate?: number; signal?: AbortSignal },
): Promise<{ buy: BybitItem[]; sell: BybitItem[] }> {
  const [buy, sell] = await Promise.all([
    fetchBybitP2P({ ...filters, tradeType: "BUY" }, opts).catch(() => []),
    fetchBybitP2P({ ...filters, tradeType: "SELL" }, opts).catch(() => []),
  ]);
  return { buy, sell };
}

/**
 * Deep sweep — paginate both book sides to enumerate every merchant currently
 * listing on the market. Each Bybit page caps at 20 rows; `pagesPerSide=15`
 * gives up to 300 ads per side (600 total). Stops early when a page comes
 * back short.
 *
 * Used by the ingest worker so the merchant directory in our DB converges
 * toward the full LKR counterparty set, not just the top 20 per side that the
 * live page renders.
 *
 * Ads are de-duplicated on `id` across pages in case Bybit reshuffles mid sweep.
 */
export async function fetchAdsDeep(
  filters: Omit<SearchFilters, "tradeType" | "page" | "rows">,
  opts?: {
    pagesPerSide?: number;
    rowsPerPage?: number;
    revalidate?: number;
    signal?: AbortSignal;
  },
): Promise<{ buy: BybitItem[]; sell: BybitItem[] }> {
  const pagesPerSide = Math.max(1, Math.min(30, opts?.pagesPerSide ?? 15));
  const rowsPerPage = Math.max(5, Math.min(20, opts?.rowsPerPage ?? 20));

  async function sweepSide(tt: TradeType): Promise<BybitItem[]> {
    const seen = new Set<string>();
    const out: BybitItem[] = [];
    for (let page = 1; page <= pagesPerSide; page++) {
      const items = await fetchBybitP2P(
        { ...filters, tradeType: tt, rows: rowsPerPage, page },
        { signal: opts?.signal, revalidate: opts?.revalidate ?? P2P_REVALIDATE },
      ).catch(() => [] as BybitItem[]);
      if (items.length === 0) break;
      for (const it of items) {
        if (!seen.has(it.id)) {
          seen.add(it.id);
          out.push(it);
        }
      }
      if (items.length < rowsPerPage) break;
    }
    return out;
  }

  const [buy, sell] = await Promise.all([
    sweepSide("BUY"),
    sweepSide("SELL"),
  ]);
  return { buy, sell };
}

/**
 * Bybit publishes only a numeric pay-method id (e.g. "14" for LKR bank
 * transfer) on the item — no inline name. We resolve names via the constants
 * table at render time, but stamp a sensible fallback here so the normalized
 * ad is still readable in raw form.
 */
const PAY_METHOD_FALLBACK_NAME: Record<string, string> = {
  "14": "Bank Transfer",
};

/** Convert Bybit item to our normalized ad shape. */
export function normalizeAd(item: BybitItem): NormalizedAd {
  const tradeType = sideToTradeType(item.side);
  // Bybit uses `userType: "PERSONAL" | "MERCHANT" | ...` — treat anything
  // non-PERSONAL as a merchant for the trust badge.
  const userType = (item.userType ?? "").toUpperCase();
  const isMerchant = userType !== "" && userType !== "PERSONAL";
  // `lastQuantity` is the unfilled remainder; falls back to total `quantity`.
  const available =
    Number(item.lastQuantity) ||
    (Number(item.quantity) || 0) - (Number(item.executedQuantity) || 0);

  return {
    id: item.id,
    tradeType,
    asset: item.tokenId,
    fiat: item.currencyId,
    price: Number(item.price) || 0,
    available: Math.max(0, available),
    minOrder: Number(item.minAmount) || 0,
    maxOrder: Number(item.maxAmount) || 0,
    payMethods: (item.payments ?? []).map((id) => ({
      id,
      name: PAY_METHOD_FALLBACK_NAME[id] ?? `Payment ${id}`,
      short: undefined,
      color: undefined,
    })),
    merchant: {
      // Bybit's `userMaskId` (the public `s...` token) is what
      // `bybit.com/en/p2p/profile/<id>/...` URLs expect. Fall back to the
      // numeric `userId` for the rare ad that omits it (only really happens
      // on placeholder rows during a Bybit rollout).
      id: item.userMaskId || item.userId,
      name: item.nickName,
      isMerchant,
      // Bybit doesn't expose Binance-style userIdentity / userGrade / vipLevel.
      // Map authTag → a Binance-shaped userIdentity string so any UI logic that
      // sniffs for "MERCHANT" still has a hook (e.g. "GA" → "GA_VERIFIED").
      userIdentity:
        item.authTag && item.authTag.length
          ? item.authTag.join(",")
          : isMerchant
            ? "MERCHANT"
            : undefined,
      grade: undefined,
      vipLevel: null,
      // `recentOrderNum` is Bybit's 30-day order count. Falls back to total
      // finishNum / orderNum so older accounts without recent activity still
      // show meaningful figures rather than zero.
      orders30d:
        Number(item.recentOrderNum ?? 0) ||
        Number(item.finishNum ?? 0) ||
        Number(item.orderNum ?? 0),
      // Bybit `recentExecuteRate` is a 0..100 percentage; the Binance shape
      // is a 0..1 fraction, so divide.
      completionRate: clamp01((Number(item.recentExecuteRate ?? 0) || 0) / 100),
      // Bybit doesn't publish per-merchant release/response timing on the list
      // endpoint; leave undefined so the UI shows a "—".
      avgReleaseSec: undefined,
      avgResponseSec: undefined,
    },
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function normalizeAds(
  items: BybitItem[],
  tradeType?: TradeType,
): NormalizedAd[] {
  const ads = items.map(normalizeAd);
  if (tradeType) return ads.filter((a) => a.tradeType === tradeType);
  return ads;
}
