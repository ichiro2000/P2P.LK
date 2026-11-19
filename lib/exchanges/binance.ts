import type { NormalizedAd, TradeType } from "@/lib/types";
import {
  BROWSER_UA,
  UpstreamError,
  clamp,
  sweep,
  type BookQuery,
  type ExchangeAdapter,
  type FetchOpts,
} from "./types";

const ENDPOINT = "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search";

/** ── Raw Binance response shape (only fields we read) ─────────────────── */
type BinanceAdvertiser = {
  userNo: string;
  nickName: string;
  userType?: string;
  userIdentity?: string;
  userGrade?: number;
  vipLevel?: number | null;
  monthOrderCount?: number;
  monthFinishRate?: number;
  /** Not in the search response today (checked 2026-11); read if it appears. */
  avgReleaseTimeOfLatestOnline?: number;
  avgResponseTime?: number;
};
type Num = string | number | null | undefined;
type BinanceAdv = {
  advNo: string;
  tradeType: TradeType;
  asset: string;
  fiatUnit: string;
  price: string;
  minSingleTransAmount: string;
  maxSingleTransAmount: string;
  /** Live per-order cap after the ad's remaining balance; ≤ maxSingleTransAmount. */
  dynamicMaxSingleTransAmount?: Num;
  /** Net USDT a taker can actually get (surplusAmount minus fees/reserve). */
  tradableQuantity?: Num;
  /** Gross remaining USDT on the ad. */
  surplusAmount?: Num;
  isTradable?: boolean;
  // Counterparty conditions (null when the ad has none).
  buyerRegDaysLimit?: Num;
  buyerKycLimit?: Num;
  buyerBtcPositionLimit?: Num;
  userTradeCountFilterTime?: Num;
  userAllTradeCountMin?: Num;
  userBuyTradeCountMin?: Num;
  userSellTradeCountMin?: Num;
  userTradeCompleteCountMin?: Num;
  userTradeCompleteRateMin?: Num;
  takerAdditionalKycRequired?: Num;
  tradeMethods: {
    identifier: string;
    tradeMethodName: string;
    tradeMethodShortName?: string;
    tradeMethodBgColor?: string;
  }[];
};
type BinanceAdItem = { adv: BinanceAdv; advertiser: BinanceAdvertiser };
type BinanceSearchResponse = { code?: string; success?: boolean; data: BinanceAdItem[] | null };

/**
 * Binance's query `tradeType` is the *taker's* intent and is inverted from
 * the publisher direction we use:
 *   our `buy`  (bids) → query SELL
 *   our `sell` (asks) → query BUY
 */
async function fetchPage(
  q: BookQuery,
  side: TradeType,
  page: number,
  rows: number,
  opts?: FetchOpts,
): Promise<BinanceAdItem[]> {
  const body = {
    asset: q.asset,
    fiat: q.fiat,
    tradeType: side === "BUY" ? "SELL" : "BUY",
    page,
    rows,
    payTypes: q.payTypes?.length ? q.payTypes : [],
    publisherType: q.publisherType ?? null,
    merchantCheck: false,
    transAmount: q.transAmount ?? "",
    countries: [],
    proMerchantAds: false,
    shieldMerchantAds: false,
  };
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": BROWSER_UA,
        clienttype: "web",
      },
      body: JSON.stringify(body),
      signal: opts?.signal,
      cache: "no-store",
    });
  } catch (err) {
    throw new UpstreamError("binance", `network error: ${(err as Error).message}`);
  }
  if (!res.ok) throw new UpstreamError("binance", `HTTP ${res.status} (${side} p${page})`);
  let json: BinanceSearchResponse;
  try {
    json = (await res.json()) as BinanceSearchResponse;
  } catch {
    throw new UpstreamError("binance", `non-JSON response (${side} p${page})`);
  }
  if (!json || (json.success === false && json.data == null)) {
    throw new UpstreamError("binance", `rejected request (code ${json?.code ?? "?"})`);
  }
  return Array.isArray(json.data) ? json.data : [];
}

const pos = (v: Num) => {
  const n = Number(v);
  return v != null && v !== "" && Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Counterparty conditions on a Binance ad. Hard ones (trade history,
 * completion rate, KYC level, BTC position) set `restricted`; account age
 * and extra KYC are listed only — almost every active taker passes them.
 */
export function binanceRestrictions(adv: Partial<BinanceAdv>): { restricted: boolean; restrictions: string[] } {
  const out: string[] = [];
  let hard = false;
  const rate = pos(adv.userTradeCompleteRateMin);
  if (rate != null) {
    hard = true;
    out.push(`≥ ${rate > 1 ? rate : Math.round(rate * 100)}% completion`);
  }
  const counts: [Num, string][] = [
    [adv.userAllTradeCountMin, "trades"],
    [adv.userBuyTradeCountMin, "buy trades"],
    [adv.userSellTradeCountMin, "sell trades"],
    [adv.userTradeCompleteCountMin, "completed trades"],
  ];
  for (const [v, label] of counts) {
    const n = pos(v);
    if (n != null) {
      hard = true;
      out.push(`≥ ${n} ${label}`);
    }
  }
  if (pos(adv.buyerKycLimit) != null) {
    hard = true;
    out.push("KYC level limit");
  }
  const btc = pos(adv.buyerBtcPositionLimit);
  if (btc != null) {
    hard = true;
    out.push(`holds ≥ ${btc} BTC`);
  }
  const days = pos(adv.buyerRegDaysLimit);
  if (days != null) out.push(`account ≥ ${days} days`);
  if (pos(adv.takerAdditionalKycRequired) != null) out.push("extra KYC check");
  return { restricted: hard, restrictions: out };
}

function normalize(item: BinanceAdItem, side: TradeType): NormalizedAd {
  const { adv, advertiser } = item;
  // Net amounts: `tradableQuantity` is what a taker can actually receive
  // (surplusAmount is gross); `dynamicMaxSingleTransAmount` is the live cap
  // per order. Both decide whether an exact-size ad can be filled.
  const available = pos(adv.tradableQuantity) ?? pos(adv.surplusAmount) ?? 0;
  const maxStatic = pos(adv.maxSingleTransAmount);
  const maxDynamic = pos(adv.dynamicMaxSingleTransAmount);
  const maxOrder =
    maxStatic != null && maxDynamic != null ? Math.min(maxStatic, maxDynamic) : (maxStatic ?? maxDynamic ?? 0);
  const { restricted, restrictions } = binanceRestrictions(adv);
  return {
    id: adv.advNo,
    tradeType: side,
    asset: adv.asset,
    fiat: adv.fiatUnit,
    price: Number(adv.price) || 0,
    available,
    minOrder: Number(adv.minSingleTransAmount) || 0,
    maxOrder,
    // Binance doesn't expose online status in search; `isTradable: false`
    // is the only "can't trade now" signal.
    ...(adv.isTradable === false ? { online: false } : {}),
    restricted,
    ...(restrictions.length ? { restrictions } : {}),
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
      userIdentity: advertiser.userIdentity,
      grade: advertiser.userGrade,
      vipLevel: advertiser.vipLevel ?? null,
      orders30d: advertiser.monthOrderCount != null ? Number(advertiser.monthOrderCount) || 0 : null,
      completionRate: Number(advertiser.monthFinishRate ?? 0),
      avgReleaseSec: advertiser.avgReleaseTimeOfLatestOnline,
      avgResponseSec: advertiser.avgResponseTime,
    },
  };
}

export const binance: ExchangeAdapter = {
  id: "binance",
  label: "Binance",
  bankPayTypes: [
    { id: "BANK", label: "Bank Transfer" },
    { id: "BankSriLanka", label: "Bank Transfer (Sri Lanka)" },
  ],
  // LKR methods from Binance's filter-conditions endpoint (checked 2026-11-20).
  payMethods: [
    { id: "BANK", label: "Bank Transfer", group: "bank" },
    { id: "BankSriLanka", label: "Bank Transfer (Sri Lanka)", group: "bank" },
    { id: "TransBank", label: "Trans Bank", group: "bank" },
    { id: "CashDeposit", label: "Cash Deposit to Bank", group: "cash" },
    { id: "EZCASH", label: "eZCash", group: "wallet" },
    { id: "Mobiletopup", label: "Airtime Mobile Top-Up", group: "other" },
  ],

  async fetchBook(q, opts) {
    const rows = clamp(opts?.rows ?? 20, 5, 20);
    const [buy, sell] = await Promise.all([
      fetchPage(q, "BUY", 1, rows, opts),
      fetchPage(q, "SELL", 1, rows, opts),
    ]);
    return {
      buy: buy.map((i) => normalize(i, "BUY")),
      sell: sell.map((i) => normalize(i, "SELL")),
    };
  },

  async fetchDeep(q, opts) {
    const pages = clamp(opts?.pagesPerSide ?? 15, 1, 30);
    const rows = clamp(opts?.rowsPerPage ?? 20, 5, 20);
    const side = (s: TradeType) =>
      sweep((p) => fetchPage(q, s, p, rows, opts), (i) => i.adv.advNo, pages, rows);
    const [buy, sell] = await Promise.all([side("BUY"), side("SELL")]);
    return {
      buy: buy.map((i) => normalize(i, "BUY")),
      sell: sell.map((i) => normalize(i, "SELL")),
    };
  },

  profileUrl(id) {
    return `https://p2p.binance.com/en/advertiserDetail?advertiserNo=${encodeURIComponent(id)}`;
  },
};
export { normalize as normalizeBinanceAd };
export type { BinanceAdItem };
