/**
 * Shape of the Bybit P2P public `/fiat/otc/item/online` response.
 * Only fields the app actually uses are typed strictly;
 * everything else falls through unknown to stay resilient to backend changes.
 */

export type TradeType = "BUY" | "SELL";

/**
 * Bybit ad item — one row from `result.items[]`. The raw response carries
 * many more fields (tradingPreferenceSet, symbolInfo, verificationOrder*, …)
 * that we don't currently use; keep them off the type to avoid noise but
 * remember they exist if a downstream feature wants them.
 */
export type BybitItem = {
  id: string;
  /** "0" = bid (publisher buys USDT), "1" = ask (publisher sells USDT) */
  side: number | string;
  userId: string;
  accountId?: string;
  nickName: string;
  tokenId: string;
  currencyId: string;
  price: string;
  premium?: string;
  /** Remaining unfilled quantity, in asset units. */
  lastQuantity: string;
  /** Original total quantity. */
  quantity: string;
  frozenQuantity?: string;
  executedQuantity?: string;
  /** Min single-order in fiat. */
  minAmount: string;
  /** Max single-order in fiat. */
  maxAmount: string;
  remark?: string;
  /** Bybit pay-method ids, e.g. ["14"] for LKR bank transfer. */
  payments: string[];
  /** Lifetime order count for the merchant. */
  orderNum?: number;
  /** Lifetime finished order count. */
  finishNum?: number;
  /** ~30-day order count. */
  recentOrderNum?: number;
  /** ~30-day completion rate, expressed 0..100. */
  recentExecuteRate?: number;
  /** "PERSONAL", "MERCHANT", … */
  userType?: string;
  authStatus?: number;
  authTag?: string[];
  isOnline?: boolean;
  blocked?: string;
  ban?: boolean;
  baned?: boolean;
};

export type BybitSearchResult = {
  count: number;
  items: BybitItem[];
};

export type BybitSearchResponse = {
  ret_code: number;
  ret_msg?: string;
  result: BybitSearchResult;
};

/** ── Domain types (normalized for app use) ─────────────────────────────── */

export type PublisherType = "merchant" | null;

export type SearchFilters = {
  asset: string;
  fiat: string;
  tradeType: TradeType;
  /** Bybit pay-method ids (numeric strings, e.g. "14" for LKR bank transfer). */
  payTypes?: string[];
  /** Amount of fiat the user wants to transact — for relevant ads only */
  transAmount?: string;
  /** Restrict to merchant-type publishers */
  publisherType?: PublisherType;
  rows?: number;
  page?: number;
};

export type NormalizedAd = {
  id: string;
  tradeType: TradeType;
  asset: string;
  fiat: string;
  price: number;
  available: number;
  minOrder: number;
  maxOrder: number;
  payMethods: {
    id: string;
    name: string;
    short?: string;
    color?: string;
  }[];
  merchant: {
    id: string;
    name: string;
    isMerchant: boolean;
    /** Free-form publisher tag. On Bybit we stamp `authTag.join(",")`
     *  (e.g. "GA", "GA,KYC") so existing UI badge logic still has a hook. */
    userIdentity?: string;
    /** Legacy Binance grade; unused on Bybit but kept on the shape so
     *  downstream typing stays stable. */
    grade?: number;
    /** Legacy Binance VIP tier (1/2/3). Bybit has no equivalent → null. */
    vipLevel?: number | null;
    orders30d: number;
    completionRate: number; // 0..1
    avgReleaseSec?: number;
    avgResponseSec?: number;
  };
};

/** Aggregate stats derived from a list of ads on one side (buy or sell). */
export type SideStats = {
  tradeType: TradeType;
  count: number;
  bestPrice: number | null;
  medianPrice: number | null;
  vwap: number | null;
  /** Total available across top N ads, in asset units */
  totalAvailable: number;
  /** Total available in fiat (price × amount) across top N ads */
  totalAvailableFiat: number;
};

/** Full market snapshot used by live overview & arbitrage. */
export type MarketSnapshot = {
  asset: string;
  fiat: string;
  buy: SideStats;
  sell: SideStats;
  spread: number | null; // sell.best - buy.best
  spreadPct: number | null; // spread / mid
  mid: number | null;
  ads: NormalizedAd[]; // top merged list (buy + sell, capped)
  fetchedAt: string; // ISO
};
