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

const ENDPOINT = "https://api2.bybit.com/fiat/otc/item/online";

/** ── Raw Bybit response shape (only fields we read) ───────────────────── */
type BybitItem = {
  id: string;
  /** "0" = bid (publisher buys), "1" = ask (publisher sells). */
  side: number | string;
  userId: string;
  /** Public `s…` token used in profile URLs. */
  userMaskId?: string;
  nickName: string;
  tokenId: string;
  currencyId: string;
  price: string;
  lastQuantity: string;
  quantity: string;
  executedQuantity?: string;
  minAmount: string;
  maxAmount: string;
  payments: string[];
  /** Lifetime counts — never shown as 30-day figures. */
  orderNum?: number;
  finishNum?: number;
  /** Orders in the last 30 days. */
  recentOrderNum?: number | null;
  /** 0..100 */
  recentExecuteRate?: number;
  /** Always "PERSONAL" in the LKR feed, merchants included — not a merchant flag. */
  userType?: string;
  /** Advertiser badges: GA = general, VA/VA1 = verified, VA2, VA3 higher
   *  verified levels, BA = block advertiser. */
  authTag?: string[];
  /** 1 = verified advertiser, 2 = general. */
  authStatus?: number;
  isOnline?: boolean;
  verificationOrderSwitch?: boolean;
  tradingPreferenceSet?: BybitPreferences | null;
};
type BybitPreferences = {
  isKyc?: number;
  hasRegisterTime?: number;
  registerTimeThreshold?: number;
  hasOrderFinishNumberDay30?: number;
  orderFinishNumberDay30?: number;
  hasCompleteRateDay30?: number;
  completeRateDay30?: string | number;
  hasNationalLimit?: number;
  nationalLimit?: string;
  hasUnPostAd?: number;
  hasSingleUserOrderLimit?: number;
  singleUserOrderLimit?: number;
};
type BybitSearchResponse = {
  ret_code: number;
  ret_msg?: string;
  result?: { count: number; items: BybitItem[] };
};

/** LKR payment methods, from Bybit's public payment list
 *  (`/fiat/otc/configuration/queryAllPaymentList`, checked 2026-11-20). */
export const BYBIT_PAY_NAMES: Record<string, string> = {
  "14": "Bank Transfer",
  "817": "Bank Transfer (Sri Lanka)",
  "18": "Cash Deposit to Bank",
  "90": "Cash in Person",
  "40": "Mobile Top-up",
  "78": "Wise",
  "814": "Genie",
  "815": "FriMi",
  "816": "HelaPay",
};
export const bybitPayName = (id: string) => BYBIT_PAY_NAMES[id] ?? `Bybit method #${id}`;

/**
 * Verified-advertiser level from Bybit's auth tags. VA / VA1 = verified,
 * VA2 and VA3 the higher verified levels; BA (block advertiser) counts as
 * the top level. Mapped onto the same 1/2/3 scale as Binance's vipLevel so
 * one tier badge works for both: 1 bronze, 2 silver, 3 gold.
 * Returns 0 for general advertisers (GA only).
 */
export function bybitVerifiedLevel(tags: readonly string[] | undefined): number {
  const t = new Set((tags ?? []).map((x) => x.toUpperCase()));
  if (t.has("BA") || t.has("VA3")) return 3;
  if (t.has("VA2")) return 2;
  if (t.has("VA") || t.has("VA1")) return 1;
  return 0;
}

/**
 * Counterparty conditions from `tradingPreferenceSet`. Trade-history
 * minimums and a verification order set `restricted`; account age,
 * nationality and "no own ads" are listed only.
 */
export function bybitRestrictions(item: Pick<BybitItem, "tradingPreferenceSet" | "verificationOrderSwitch">) {
  const p = item.tradingPreferenceSet ?? {};
  const out: string[] = [];
  let hard = false;
  const rate = Number(p.completeRateDay30);
  if (p.hasCompleteRateDay30 === 1 && rate > 0) {
    hard = true;
    out.push(`≥ ${rate}% completion (30d)`);
  }
  const orders = Number(p.orderFinishNumberDay30);
  if (p.hasOrderFinishNumberDay30 === 1 && orders > 0) {
    hard = true;
    out.push(`≥ ${orders} orders (30d)`);
  }
  if (item.verificationOrderSwitch) {
    hard = true;
    out.push("verification order first");
  }
  const days = Number(p.registerTimeThreshold);
  if (p.hasRegisterTime === 1 && days > 0) out.push(`account ≥ ${days} days`);
  if (p.hasNationalLimit === 1 && p.nationalLimit) out.push(`${p.nationalLimit} residents only`);
  if (p.hasUnPostAd === 1) out.push("takers without own ads");
  return { restricted: hard, restrictions: out };
}

/** Bybit's `side` is direct (no inversion): 0 → bids, 1 → asks. */
async function fetchPage(
  q: BookQuery,
  side: TradeType,
  page: number,
  rows: number,
  opts?: FetchOpts,
): Promise<BybitItem[]> {
  const body = {
    userId: 0,
    tokenId: q.asset,
    currencyId: q.fiat,
    payment: q.payTypes?.length ? q.payTypes : [],
    side: side === "BUY" ? "0" : "1",
    size: String(rows),
    page: String(page),
    amount: q.transAmount ?? "",
    authMaker: q.publisherType === "merchant",
    canTrade: false,
  };
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": BROWSER_UA,
        Origin: "https://www.bybit.com",
        Referer: "https://www.bybit.com/",
      },
      body: JSON.stringify(body),
      signal: opts?.signal,
      cache: "no-store",
    });
  } catch (err) {
    throw new UpstreamError("bybit", `network error: ${(err as Error).message}`);
  }
  if (!res.ok) throw new UpstreamError("bybit", `HTTP ${res.status} (${side} p${page})`);
  let json: BybitSearchResponse;
  try {
    json = (await res.json()) as BybitSearchResponse;
  } catch {
    throw new UpstreamError("bybit", `non-JSON response (${side} p${page})`);
  }
  if (!json || json.ret_code !== 0) {
    throw new UpstreamError("bybit", `ret_code ${json?.ret_code}: ${json?.ret_msg ?? ""}`);
  }
  return json.result?.items ?? [];
}

function normalize(item: BybitItem, side: TradeType): NormalizedAd {
  // `userType` is "PERSONAL" for everyone; the VA auth tags are the real
  // verified-advertiser signal (F5).
  const level = bybitVerifiedLevel(item.authTag);
  const isMerchant = level > 0;
  const { restricted, restrictions } = bybitRestrictions(item);
  const recent = item.recentOrderNum;
  const available =
    Number(item.lastQuantity) ||
    (Number(item.quantity) || 0) - (Number(item.executedQuantity) || 0);
  const rate = (Number(item.recentExecuteRate ?? 0) || 0) / 100;
  return {
    id: item.id,
    tradeType: side,
    asset: item.tokenId,
    fiat: item.currencyId,
    price: Number(item.price) || 0,
    available: Math.max(0, available),
    minOrder: Number(item.minAmount) || 0,
    maxOrder: Number(item.maxAmount) || 0,
    payMethods: (item.payments ?? []).map((id) => ({ id, name: bybitPayName(id) })),
    ...(typeof item.isOnline === "boolean" ? { online: item.isOnline } : {}),
    restricted,
    ...(restrictions.length ? { restrictions } : {}),
    merchant: {
      id: item.userMaskId || item.userId,
      name: item.nickName,
      isMerchant,
      userIdentity: item.authTag?.length ? item.authTag.join(",") : undefined,
      grade: undefined,
      vipLevel: level > 0 ? level : null,
      // 30-day count only. Lifetime orderNum/finishNum are never substituted.
      orders30d: recent != null && Number.isFinite(Number(recent)) ? Number(recent) : null,
      completionRate: clamp(Number.isFinite(rate) ? rate : 0, 0, 1),
      avgReleaseSec: undefined,
      avgResponseSec: undefined,
    },
  };
}

export const bybit: ExchangeAdapter = {
  id: "bybit",
  label: "Bybit",
  // 817 "Bank Transfer (Sri Lanka)" is a second LKR bank rail; ingest and the
  // cached books fetch both (changes what's stored from 2026-11-20 on).
  bankPayTypes: [
    { id: "14", label: "Bank Transfer" },
    { id: "817", label: "Bank Transfer (Sri Lanka)" },
  ],
  payMethods: [
    { id: "14", label: "Bank Transfer", group: "bank" },
    { id: "817", label: "Bank Transfer (Sri Lanka)", group: "bank" },
    { id: "18", label: "Cash Deposit to Bank", group: "cash" },
    { id: "90", label: "Cash in Person", group: "cash" },
    { id: "814", label: "Genie", group: "wallet" },
    { id: "815", label: "FriMi", group: "wallet" },
    { id: "816", label: "HelaPay", group: "wallet" },
    { id: "78", label: "Wise", group: "other" },
    { id: "40", label: "Mobile Top-up", group: "other" },
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
      sweep((p) => fetchPage(q, s, p, rows, opts), (i) => i.id, pages, rows);
    const [buy, sell] = await Promise.all([side("BUY"), side("SELL")]);
    return {
      buy: buy.map((i) => normalize(i, "BUY")),
      sell: sell.map((i) => normalize(i, "SELL")),
    };
  },

  profileUrl(id, asset, fiat) {
    return `https://www.bybit.com/en/p2p/profile/${encodeURIComponent(id)}/${asset}/${fiat}/item`;
  },
};

export { normalize as normalizeBybitAd };
export type { BybitItem };
