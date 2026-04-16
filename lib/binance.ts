import type {
  BinanceAdItem,
  BinanceSearchResponse,
  NormalizedAd,
  SearchFilters,
  TradeType,
} from "./types";

const BINANCE_P2P_ENDPOINT =
  "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search";

/** Seconds of ISR caching for raw market calls. */
export const P2P_REVALIDATE = 20;

/**
 * Fetch one side (BUY or SELL) of a single market from Binance P2P.
 * Throws on network or non-200 response. Caller decides how to degrade.
 */
export async function fetchBinanceP2P(
  filters: SearchFilters,
  opts?: { revalidate?: number; signal?: AbortSignal },
): Promise<BinanceAdItem[]> {
  const body = {
    asset: filters.asset,
    fiat: filters.fiat,
    tradeType: filters.tradeType,
    page: filters.page ?? 1,
    rows: filters.rows ?? 20,
    payTypes: filters.payTypes?.length ? filters.payTypes : [],
    publisherType: filters.publisherType ?? null,
    merchantCheck: false,
    transAmount: filters.transAmount ?? "",
    // Newer endpoint fields — harmless if ignored
    countries: [],
    proMerchantAds: false,
    shieldMerchantAds: false,
  };

  const res = await fetch(BINANCE_P2P_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      // Binance returns a captcha page if User-Agent looks scripty.
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "clienttype": "web",
    },
    body: JSON.stringify(body),
    signal: opts?.signal,
    next: { revalidate: opts?.revalidate ?? P2P_REVALIDATE },
  });

  if (!res.ok) {
    throw new Error(
      `Binance P2P responded ${res.status} for ${filters.asset}/${filters.fiat} ${filters.tradeType}`,
    );
  }

  const json = (await res.json()) as BinanceSearchResponse;
  if (!json || !Array.isArray(json.data)) return [];
  return json.data;
}

/** Fetch both book sides in parallel.
 *  Note on semantics: Binance's query `tradeType` is the *requester's* intent
 *  ("I want to BUY / SELL"), while `adv.tradeType` in the response is the
 *  *publisher's* direction. They're inverted:
 *    - query BUY  → returns SELL ads (asks)  → our `sell` book side
 *    - query SELL → returns BUY ads (bids)   → our `buy`  book side
 */
export async function fetchBothSides(
  filters: Omit<SearchFilters, "tradeType">,
  opts?: { revalidate?: number; signal?: AbortSignal },
): Promise<{ buy: BinanceAdItem[]; sell: BinanceAdItem[] }> {
  const [buy, sell] = await Promise.all([
    // "I want to sell" → publishers who want to BUY → bids
    fetchBinanceP2P({ ...filters, tradeType: "SELL" }, opts).catch(() => []),
    // "I want to buy" → publishers who want to SELL → asks
    fetchBinanceP2P({ ...filters, tradeType: "BUY" }, opts).catch(() => []),
  ]);
  return { buy, sell };
}

/**
 * Deep sweep — paginate both book sides to enumerate every merchant currently
 * listing on the market. Each Binance page caps at 20 rows, so
 * `pagesPerSide=5` gives up to 100 ads per side (200 total). Stops early when
 * a page comes back short (Binance has no more results).
 *
 * Used by the ingest worker so the merchant directory in our DB converges
 * toward the full LKR counterparty set, not just the top 20 per side that the
 * live page renders.
 *
 * Ads are de-duplicated on adNo across pages in case Binance reshuffles mid
 * sweep.
 */
export async function fetchAdsDeep(
  filters: Omit<SearchFilters, "tradeType" | "page" | "rows">,
  opts?: {
    pagesPerSide?: number;
    rowsPerPage?: number;
    revalidate?: number;
    signal?: AbortSignal;
  },
): Promise<{ buy: BinanceAdItem[]; sell: BinanceAdItem[] }> {
  const pagesPerSide = Math.max(1, Math.min(10, opts?.pagesPerSide ?? 5));
  const rowsPerPage = Math.max(5, Math.min(20, opts?.rowsPerPage ?? 20));

  async function sweepSide(query: TradeType): Promise<BinanceAdItem[]> {
    const seen = new Set<string>();
    const out: BinanceAdItem[] = [];
    for (let page = 1; page <= pagesPerSide; page++) {
      const items = await fetchBinanceP2P(
        { ...filters, tradeType: query, rows: rowsPerPage, page },
        { signal: opts?.signal, revalidate: opts?.revalidate ?? P2P_REVALIDATE },
      ).catch(() => [] as BinanceAdItem[]);
      if (items.length === 0) break;
      for (const it of items) {
        if (!seen.has(it.adv.advNo)) {
          seen.add(it.adv.advNo);
          out.push(it);
        }
      }
      if (items.length < rowsPerPage) break;
    }
    return out;
  }

  const [buyQueryResult, sellQueryResult] = await Promise.all([
    sweepSide("SELL"), // query SELL → publishers who BUY → our `buy` side
    sweepSide("BUY"), // query BUY  → publishers who SELL → our `sell` side
  ]);
  return { buy: buyQueryResult, sell: sellQueryResult };
}

/** Convert Binance item to our normalized ad shape. */
export function normalizeAd(item: BinanceAdItem): NormalizedAd {
  const { adv, advertiser } = item;
  return {
    id: adv.advNo,
    tradeType: adv.tradeType,
    asset: adv.asset,
    fiat: adv.fiatUnit,
    price: Number(adv.price) || 0,
    available: Number(adv.surplusAmount ?? adv.tradableQuantity) || 0,
    minOrder: Number(adv.minSingleTransAmount) || 0,
    maxOrder: Number(adv.maxSingleTransAmount) || 0,
    payMethods: (adv.tradeMethods ?? []).map((m) => ({
      id: m.identifier,
      name: m.tradeMethodName,
      short: m.tradeMethodShortName,
      color: m.tradeMethodBgColor,
    })),
    merchant: {
      id: advertiser.userNo,
      name: advertiser.nickName,
      isMerchant:
        (advertiser.userType ?? "").toLowerCase() === "merchant" ||
        /MERCHANT/i.test(advertiser.userIdentity ?? ""),
      grade: advertiser.userGrade,
      orders30d: Number(advertiser.monthOrderCount ?? 0),
      completionRate: Number(advertiser.monthFinishRate ?? 0),
      avgReleaseSec: advertiser.avgReleaseTimeOfLatestOnline,
      avgResponseSec: advertiser.avgResponseTime,
    },
  };
}

export function normalizeAds(
  items: BinanceAdItem[],
  tradeType?: TradeType,
): NormalizedAd[] {
  const ads = items.map(normalizeAd);
  if (tradeType) return ads.filter((a) => a.tradeType === tradeType);
  return ads;
}
