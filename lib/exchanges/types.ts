import type { NormalizedAd } from "@/lib/types";

export const EXCHANGE_IDS = ["binance", "bybit"] as const;
export type ExchangeId = (typeof EXCHANGE_IDS)[number];

export function isExchangeId(v: unknown): v is ExchangeId {
  return typeof v === "string" && (EXCHANGE_IDS as readonly string[]).includes(v);
}

/** Payment-method group, for the grouped filter list. */
export type PayGroup = "bank" | "wallet" | "cash" | "other";

export type PayTypeOption = { id: string; label: string; group?: PayGroup };

/** Filter selection meaning every payment method (not just bank rails). */
export const ALL_PAY_METHODS = "all";

export const PAY_GROUP_LABEL: Record<PayGroup, string> = {
  bank: "Bank transfers",
  wallet: "Mobile wallets",
  cash: "Cash",
  other: "Other",
};

/** What every book fetch needs. Sides are always returned in our vocabulary:
 *  `buy` = bids (publishers buying the asset), `sell` = asks. */
export type BookQuery = {
  asset: string;
  fiat: string;
  /** Exchange-specific pay-method ids. Empty / omitted = all bank rails. */
  payTypes?: string[];
  /** "merchant" restricts to verified merchants where the exchange supports it. */
  publisherType?: "merchant" | null;
  /** Fiat amount the taker wants to trade — filters to ads that accept it. */
  transAmount?: string;
};

export type Book = { buy: NormalizedAd[]; sell: NormalizedAd[] };

export type FetchOpts = { signal?: AbortSignal };

/** Thrown when the exchange itself failed (network, non-200, bad payload).
 *  Callers must surface this as an error — never as an empty market. */
export class UpstreamError extends Error {
  constructor(
    public exchange: ExchangeId,
    message: string,
  ) {
    super(`[${exchange}] ${message}`);
    this.name = "UpstreamError";
  }
}

export interface ExchangeAdapter {
  id: ExchangeId;
  label: string;
  /** Bank-transfer rails for LKR on this exchange. The default market:
   *  ingest, history, alerts and the cached books all use these. */
  bankPayTypes: PayTypeOption[];
  /** Every LKR payment method on this exchange (bank rails first), for the
   *  filter. Non-bank views are fetched live. */
  payMethods: PayTypeOption[];
  /** Top `rows` ads per side (single page). */
  fetchBook(q: BookQuery, opts?: FetchOpts & { rows?: number }): Promise<Book>;
  /** Paginated sweep of both sides — every advertiser currently listing. */
  fetchDeep(
    q: BookQuery,
    opts?: FetchOpts & { pagesPerSide?: number; rowsPerPage?: number },
  ): Promise<Book>;
  /** Public profile URL for an advertiser on this exchange. */
  profileUrl(merchantId: string, asset: string, fiat: string): string;
}

export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

/** Resolve a filter-bar selection into the ids to send upstream:
 *  "" = all bank rails (the default market), "all" = every payment method,
 *  otherwise one known method id. Unknown ids fall back to the bank rails. */
export function resolvePayTypes(
  adapter: ExchangeAdapter,
  selection: string | null | undefined,
): string[] {
  const banks = adapter.bankPayTypes.map((p) => p.id);
  if (!selection) return banks;
  if (selection === ALL_PAY_METHODS) return adapter.payMethods.map((p) => p.id);
  return adapter.payMethods.some((p) => p.id === selection) ? [selection] : banks;
}

/** Label for a filter selection, or null for the default (all bank rails). */
export function payTypeLabel(adapter: ExchangeAdapter, selection: string | null | undefined): string | null {
  if (!selection) return null;
  if (selection === ALL_PAY_METHODS) return "all payment methods";
  return adapter.payMethods.find((p) => p.id === selection)?.label ?? null;
}

/** Shared pagination helper: fetch pages until a short page or the cap. A
 *  failure on page 1 propagates (the side is unknown); a failure on a later
 *  page just ends the sweep with what we have. */
export async function sweep<T>(
  fetchPage: (page: number) => Promise<T[]>,
  keyOf: (item: T) => string,
  pages: number,
  rowsPerPage: number,
): Promise<T[]> {
  const seen = new Set<string>();
  const out: T[] = [];
  for (let page = 1; page <= pages; page++) {
    let items: T[];
    try {
      items = await fetchPage(page);
    } catch (err) {
      if (page === 1) throw err;
      break;
    }
    if (items.length === 0) break;
    for (const it of items) {
      const k = keyOf(it);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(it);
      }
    }
    if (items.length < rowsPerPage) break;
  }
  return out;
}

export function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
