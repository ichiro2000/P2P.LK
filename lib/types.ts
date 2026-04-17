/**
 * Shape of the Binance P2P public `adv/search` response.
 * Only fields the app actually uses are typed strictly;
 * everything else falls through unknown to stay resilient to backend changes.
 */

export type TradeType = "BUY" | "SELL";

export type PayTypeBadge = {
  identifier: string;
  tradeMethodName: string;
  tradeMethodShortName?: string;
  tradeMethodBgColor?: string;
};

export type BinanceAdvertiser = {
  userNo: string;
  nickName: string;
  /** "merchant" or "user" */
  userType?: string;
  /** e.g. MASS_MERCHANT, BLOCK_MERCHANT */
  userIdentity?: string;
  userGrade?: number;
  /** Binance's actual tier driver (1 = Bronze, 2 = Silver, 3 = Gold).
   *  Only populated when userType = "merchant". */
  vipLevel?: number | null;
  monthOrderCount?: number;
  /** 0..1 */
  monthFinishRate?: number;
  /** 0..1 — positive review rate */
  positiveRate?: number;
  /** seconds */
  avgReleaseTimeOfLatestOnline?: number;
  /** seconds */
  avgResponseTime?: number;
};

export type BinanceAdv = {
  advNo: string;
  classify?: string;
  tradeType: TradeType;
  asset: string;
  fiatUnit: string;
  price: string;
  minSingleTransAmount: string;
  maxSingleTransAmount: string;
  tradableQuantity: string;
  surplusAmount: string;
  tradeMethods: PayTypeBadge[];
  isTradable?: boolean;
  autoReplyMsg?: string;
};

export type BinanceAdItem = {
  adv: BinanceAdv;
  advertiser: BinanceAdvertiser;
};

export type BinanceSearchResponse = {
  code?: string;
  message?: string | null;
  success?: boolean;
  total?: number;
  data: BinanceAdItem[];
};

/** ── Domain types (normalized for app use) ─────────────────────────────── */

export type PublisherType = "merchant" | null;

export type SearchFilters = {
  asset: string;
  fiat: string;
  tradeType: TradeType;
  /** Pay type identifiers (Binance uses e.g. "BANKTransferSRILANKA") */
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
    /** Binance `userIdentity` — MASS_MERCHANT, BLOCK_MERCHANT, etc. */
    userIdentity?: string;
    /** Binance `userGrade` — merchant-vs-user flag, NOT the tier. */
    grade?: number;
    /** Binance `vipLevel` (1/2/3) — the real tier: bronze / silver / gold. */
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
