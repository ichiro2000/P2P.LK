import type { NormalizedAd, TradeType } from "@/lib/types";
import { binanceFetchMany, type BinanceCall } from "./binance-http";
import {
  UpstreamError,
  clamp,
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
function pageCall(q: BookQuery, side: TradeType, page: number, rows: number): BinanceCall {
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
  return { url: ENDPOINT, method: "POST", body: JSON.stringify(body) };
}

async function parsePage(res: Response, side: TradeType, page: number): Promise<BinanceAdItem[]> {
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

/** Fetch several (side, page) pairs in one go — one relay request when the
 *  relay is on. Each entry resolves to its items or its error. */
async function fetchPages(
  q: BookQuery,
  wanted: { side: TradeType; page: number }[],
  rows: number,
  opts?: FetchOpts,
): Promise<PromiseSettledResult<BinanceAdItem[]>[]> {
  let responses: Response[];
  try {
    responses = await binanceFetchMany(wanted.map((w) => pageCall(q, w.side, w.page, rows)), opts?.signal);
  } catch (err) {
    throw new UpstreamError("binance", `network error: ${(err as Error).message}`);
  }
  return Promise.allSettled(responses.map((r, i) => parsePage(r, wanted[i].side, wanted[i].page)));
}

/** Pages per batch in a deep fetch. A typical LKR book is under 5 pages a
 *  side, so most sweeps finish in one relay request. */
const PAGE_BATCH = 5;

/** Same rules as `sweep` (types.ts): page 1 failing throws; a later failure,
 *  an empty or a short page ends that side; ads are de-duplicated. */
async function deepSides(q: BookQuery, pages: number, rows: number, opts?: FetchOpts) {
  const acc: Record<TradeType, { items: BinanceAdItem[]; seen: Set<string>; done: boolean }> = {
    BUY: { items: [], seen: new Set(), done: false },
    SELL: { items: [], seen: new Set(), done: false },
  };
  for (let from = 1; from <= pages; from += PAGE_BATCH) {
    const to = Math.min(pages, from + PAGE_BATCH - 1);
    const wanted = (["BUY", "SELL"] as TradeType[])
      .filter((s) => !acc[s].done)
      .flatMap((side) => Array.from({ length: to - from + 1 }, (_, k) => ({ side, page: from + k })));
    if (wanted.length === 0) break;
    const results = await fetchPages(q, wanted, rows, opts);
    wanted.forEach((w, i) => {
      const a = acc[w.side];
      if (a.done) return;
      const r = results[i];
      if (r.status === "rejected") {
        if (w.page === 1) throw r.reason;
        a.done = true;
        return;
      }
      if (r.value.length === 0) {
        a.done = true;
        return;
      }
      for (const it of r.value) {
        if (!a.seen.has(it.adv.advNo)) {
          a.seen.add(it.adv.advNo);
          a.items.push(it);
        }
      }
      if (r.value.length < rows) a.done = true;
    });
  }
  return { buy: acc.BUY.items, sell: acc.SELL.items };
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
    const [b, s] = await fetchPages(q, [{ side: "BUY", page: 1 }, { side: "SELL", page: 1 }], rows, opts);
    if (b.status === "rejected") throw b.reason;
    if (s.status === "rejected") throw s.reason;
    const buy = b.value;
    const sell = s.value;
    return {
      buy: buy.map((i) => normalize(i, "BUY")),
      sell: sell.map((i) => normalize(i, "SELL")),
    };
  },

  async fetchDeep(q, opts) {
    const pages = clamp(opts?.pagesPerSide ?? 15, 1, 30);
    const rows = clamp(opts?.rowsPerPage ?? 20, 5, 20);
    const { buy, sell } = await deepSides(q, pages, rows, opts);
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
