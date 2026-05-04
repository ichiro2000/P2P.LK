/**
 * Product scope — Wise (USD) P2P with USDT settlement.
 *
 * The codebase originally narrowed to Sri Lankan Rupee bank transfers; this
 * branch flips the lock to USD / Wise so the same shells (live market,
 * historical, merchants, liquidity, risk, alerts, reports) operate on the
 * Bybit USD/Wise book instead.
 */

export const ASSET = "USDT" as const;
export type Asset = typeof ASSET;

/**
 * Asia/Colombo timezone is preserved as the server's bucketing tz so that the
 * existing report and historical charts keep producing identical buckets
 * regardless of the host region. The fiat changes; the bucketing tz does not.
 *
 * No DST in Colombo — safe as a fixed integer.
 */
export const SLT_TZ = "Asia/Colombo" as const;
export const SLT_OFFSET_SEC = 5 * 3600 + 30 * 60;

/** Kept as a one-element array so tests that expected an array still pass. */
export const ASSETS = [ASSET] as const;

export type FiatOption = {
  code: string;
  name: string;
  symbol: string;
  flag: string;
};

/** Locked to USD. */
export const FIAT: FiatOption = {
  code: "USD",
  name: "US Dollar",
  symbol: "$",
  flag: "🇺🇸",
};

/** Historical multi-fiat list kept as a 1-element array for compatibility
 *  (filter validators, report generators that expected FIATS.some). */
export const FIATS: FiatOption[] = [FIAT];

export function getFiat(code: string): FiatOption | undefined {
  return code.toUpperCase() === FIAT.code ? FIAT : undefined;
}

/**
 * The only pay-method identifier we accept on this build. Discovered
 * empirically from Bybit's `/fiat/otc/item/online` response for USD: pay-id
 * `"78"` is what Bybit's web UI labels "Wise" — confirmed by cross-checking
 * the advertiser list at `bybit.com/en/p2p/buy/USDT/USD?payment=Wise`.
 *
 * Note: Bybit also has pay-id `"416"` whose ads occasionally include "Wise"
 * in the merchant nickname (e.g. "Fast+safe-Wise"), but the prices on that
 * rail cluster around $0.99 vs the $1.01-$1.02 visible in the UI's "Wise"
 * filter. `416` is a different (cheaper) rail; the UI doesn't surface it
 * under the Wise label, and we don't either.
 *
 * Naming kept as `BANK_TRANSFER_*` so the wider codebase (filter bar, ingest,
 * reports) does not need a churn rename for what is conceptually still a
 * "single bank-style payment rail". The label is what users see.
 */
export const BANK_TRANSFER_IDS = ["78"] as const;
export type BankTransferId = (typeof BANK_TRANSFER_IDS)[number];

export const BANK_TRANSFER_OPTIONS: { id: BankTransferId; label: string }[] = [
  { id: "78", label: "Wise (USD)" },
];

/**
 * Resolve the filter bar's payType selection into the list we actually pass
 * to Bybit. Empty string means "all rails for this fiat" — which on this
 * deployment is Wise only.
 */
export function resolveBankPayTypes(selection: string | null | undefined): string[] {
  if (!selection) return [...BANK_TRANSFER_IDS];
  const match = BANK_TRANSFER_IDS.find((id) => id === selection);
  return match ? [match] : [...BANK_TRANSFER_IDS];
}

/** Legacy: kept for the filter-bar API which reads by fiat code. */
export const PAY_TYPES_BY_FIAT: Record<
  string,
  { id: string; label: string }[]
> = {
  USD: BANK_TRANSFER_OPTIONS.slice(),
};

export const MERCHANT_TYPES = [
  { id: "merchant", label: "Verified merchants" },
  { id: "all", label: "All publishers" },
] as const;

export type MerchantTypeId = (typeof MERCHANT_TYPES)[number]["id"];

/**
 * Tier amounts — used by the "Top sellers per amount" tier table to ask the
 * Bybit endpoint for matching ads at a fixed transaction amount, then
 * surface the merchants that actually accept that ticket.
 *
 * Amounts are in USD; aligns with how Wise users size individual P2P swaps.
 */
export const TIER_AMOUNTS_USD = [10, 50, 100, 300, 500, 1000] as const;
export type TierAmount = (typeof TIER_AMOUNTS_USD)[number];

export const PAYMENT_LABEL = "Wise" as const;
