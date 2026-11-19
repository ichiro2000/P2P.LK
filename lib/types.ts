/** Normalized domain types shared by every exchange adapter. */

export type TradeType = "BUY" | "SELL";

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
  /**
   * Advertiser online right now. Bybit sends `isOnline`; Binance doesn't
   * expose it (its search only lists tradable ads), so it stays undefined.
   * `undefined` = unknown, treated as online.
   */
  online?: boolean;
  /**
   * The ad only accepts takers who meet conditions beyond a normal verified
   * account: a minimum completion rate or order count, a verification
   * order, or (Binance) a KYC / BTC-position limit. Such ads are left out
   * of walks and tradable depth by default. `undefined` = none known.
   */
  restricted?: boolean;
  /** Every counterparty condition we could read, human readable
   *  ("≥ 85% completion (30d)", "account ≥ 15 days", …). Includes soft
   *  ones (account age, nationality, extra KYC) that don't set `restricted`. */
  restrictions?: string[];
  merchant: {
    id: string;
    name: string;
    isMerchant: boolean;
    /** Binance `userIdentity` — MASS_MERCHANT, BLOCK_MERCHANT, etc. */
    userIdentity?: string;
    /** Binance `userGrade` — merchant-vs-user flag, NOT the tier. */
    grade?: number;
    /** Tier level 1/2/3 → bronze / silver / gold. Binance `vipLevel`;
     *  Bybit derived from the VA / VA2 / VA3 auth tags. */
    vipLevel?: number | null;
    /** Completed orders in the last 30 days. `null` = the exchange didn't
     *  send a 30-day count (never a lifetime count in disguise). */
    orders30d: number | null;
    completionRate: number; // 0..1
    /** Not sent by either search endpoint today; kept for profile data. */
    avgReleaseSec?: number;
    avgResponseSec?: number;
  };
};

/** Aggregate stats derived from a list of ads on one side (buy or sell). */
export type SideStats = {
  tradeType: TradeType;
  count: number;
  /** Top of book: lowest ask / highest bid among all listed ads. */
  bestPrice: number | null;
  /**
   * Near-touch median: median price of the ads within ±2 % of this side's
   * best price (`NEAR_TOUCH_BAND`). Far-off ads are ignored so a thin book
   * padded with 10 %-off listings doesn't drag it.
   */
  medianPrice: number | null;
  /**
   * Near-touch VWAP: average price of the ads within ±2 % of the best,
   * weighted by the USDT one order could take from each ad
   * (min(available, maxOrder / price)).
   */
  vwap: number | null;
  /** Ads inside the ±2 % near-touch band (the median / VWAP inputs). */
  nearTouchCount?: number;
  /** Total available across top N ads, in asset units (every listed ad). */
  totalAvailable: number;
  /** Total available in fiat (price × amount) across top N ads */
  totalAvailableFiat: number;
  /** USDT on online, unrestricted ads only — what a typical taker can reach. */
  tradableAvailable?: number;
  /** Ads left out of `tradableAvailable` (offline or restricted). */
  excludedCount?: number;
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
