/**
 * Binance P2P advertiser "Trade Info" — the same two public endpoints the
 * advertiserDetail page calls:
 *
 *   GET  /bapi/c2c/v2/friendly/c2c/user/profile-and-ads-list?userNo=…
 *        → userDetailVo.userStatsRet: 30-day and all-time completed buy/sell
 *          orders, avg release/pay time, register & first-trade days,
 *          counterparties; plus deposit (margin), KYC flags, last active.
 *   POST /bapi/c2c/v1/friendly/c2c/review/user-review-statistics {userNo}
 *        → positive/negative feedback counts.
 *
 * Bybit's equivalent needs a logged-in session, so Bybit merchants only have
 * what their ads carry.
 *
 * Parsing is strict: missing core numbers → null (never 0), so "unknown" is
 * never shown as "none".
 */

import { binanceFetchMany } from "./binance-http";

const BASE = "https://p2p.binance.com/bapi/c2c";

export type BinanceProfile = {
  userNo: string;
  nickName: string | null;
  /** All-time completed orders, split by the merchant's side. */
  completedOrders: number | null;
  completedBuy: number | null;
  completedSell: number | null;
  /** Latest 30 days. */
  orders30d: number | null;
  buy30d: number | null;
  sell30d: number | null;
  completion30d: number | null; // 0..1
  avgReleaseSec: number | null;
  avgPaySec: number | null;
  registerDays: number | null;
  firstTradeDays: number | null;
  counterparties: number | null;
  /** Security deposit held by Binance for the merchant. */
  depositUsdt: number | null;
  kycVerified: boolean | null;
  emailVerified: boolean | null;
  mobileVerified: boolean | null;
  /** "c2c_only" = P2P-only trader. */
  tradeType: string | null;
  userIdentity: string | null;
  vipLevel: number | null;
  lastActiveMs: number | null;
};

export type BinanceReviews = {
  positive: number;
  negative: number;
  /** positive / (positive + negative); null when there are no reviews. */
  positiveRate: number | null;
};

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const int = (v: unknown) => {
  const n = num(v);
  return n == null || n < 0 ? null : Math.round(n);
};
const bool = (v: unknown) => (typeof v === "boolean" ? v : null);

export function parseBinanceProfile(json: unknown): BinanceProfile | null {
  const ud = (json as { data?: { userDetailVo?: Record<string, unknown> } })?.data?.userDetailVo;
  if (!ud || typeof ud.userNo !== "string") return null;
  const s = (ud.userStatsRet ?? {}) as Record<string, unknown>;
  const completion = num(s.finishRateLatest30day ?? ud.monthFinishRate);
  const margin = num(ud.margin);
  return {
    userNo: ud.userNo,
    nickName: typeof ud.nickName === "string" ? ud.nickName.trim() : null,
    completedOrders: int(s.completedOrderNum ?? ud.orderCount),
    completedBuy: int(s.completedBuyOrderNum),
    completedSell: int(s.completedSellOrderNum),
    orders30d: int(s.completedOrderNumOfLatest30day ?? ud.monthOrderCount),
    buy30d: int(s.completedBuyOrderNumOfLatest30day),
    sell30d: int(s.completedSellOrderNumOfLatest30day),
    completion30d: completion != null && completion >= 0 && completion <= 1 ? completion : null,
    avgReleaseSec: num(s.avgReleaseTimeOfLatest30day),
    avgPaySec: num(s.avgPayTimeOfLatest30day),
    registerDays: int(s.registerDays ?? ud.registerDays),
    firstTradeDays: int(s.firstOrderDays ?? ud.firstOrderDays),
    counterparties: int(s.counterpartyCount),
    depositUsdt: ud.marginUnit === "USDT" ? margin : null,
    kycVerified: bool(ud.kycVerified),
    emailVerified: bool(ud.emailVerified),
    mobileVerified: bool(ud.bindMobile),
    tradeType: typeof ud.chanelInvolved === "string" ? ud.chanelInvolved : null,
    userIdentity: typeof ud.userIdentity === "string" ? ud.userIdentity : null,
    vipLevel: int(ud.vipLevel),
    lastActiveMs: int(ud.lastActiveTime),
  };
}

export function parseBinanceReviews(json: unknown): BinanceReviews | null {
  const d = (json as { data?: Record<string, unknown>; success?: boolean })?.data;
  if (!d) return null;
  const positive = int(d.positiveCount);
  const negative = int(d.negativeCount);
  if (positive == null || negative == null) return null;
  const total = positive + negative;
  return { positive, negative, positiveRate: total ? positive / total : null };
}

/** Both requests together (one relay request in production). Reviews are
 *  optional (null if that call fails). */
export async function fetchBinanceTradeInfo(
  userNo: string,
  timeoutMs = 6000,
): Promise<{ profile: BinanceProfile; reviews: BinanceReviews | null } | null> {
  if (!/^[sS]?[A-Za-z0-9]{10,64}$/.test(userNo)) return null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let responses: Response[];
  try {
    responses = await binanceFetchMany(
      [
        { url: `${BASE}/v2/friendly/c2c/user/profile-and-ads-list?userNo=${encodeURIComponent(userNo)}`, method: "GET" },
        { url: `${BASE}/v1/friendly/c2c/review/user-review-statistics`, method: "POST", body: JSON.stringify({ userNo }) },
      ],
      ac.signal,
    );
  } finally {
    clearTimeout(timer);
  }
  const asJson = async (res: Response) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as unknown;
  };
  const [p, r] = await Promise.allSettled(responses.map(asJson));
  if (p.status !== "fulfilled") throw p.reason instanceof Error ? p.reason : new Error(String(p.reason));
  const profile = parseBinanceProfile(p.value);
  if (!profile) return null;
  return { profile, reviews: r.status === "fulfilled" ? parseBinanceReviews(r.value) : null };
}
