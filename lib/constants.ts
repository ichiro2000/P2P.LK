/**
 * Product scope — Sri Lankan Rupee P2P with bank-transfer settlement only.
 *
 * The app used to be multi-fiat / multi-rail; we've intentionally narrowed it
 * to the slice that actually matches the Sri Lankan user's workflow.
 */

export const ASSET = "USDT" as const;
export type Asset = typeof ASSET;

/**
 * Sri Lanka Time — used for every server-side date bucketing / label. On the
 * server, `Date#getHours()` etc. default to the container's tz (UTC in prod),
 * which would shift every displayed time ~5.5h from what users see on their
 * clocks. Apply this offset (or use `timeZone: SLT_TZ` with Intl) to render /
 * bucket in Asia/Colombo. No DST — safe as a fixed integer.
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

/** Locked to LKR. */
export const FIAT: FiatOption = {
  code: "LKR",
  name: "Sri Lankan Rupee",
  symbol: "Rs",
  flag: "🇱🇰",
};

/** Historical multi-fiat list kept as a 1-element array for compatibility
 *  (filter validators, report generators that expected FIATS.some). */
export const FIATS: FiatOption[] = [FIAT];

export function getFiat(code: string): FiatOption | undefined {
  return code.toUpperCase() === FIAT.code ? FIAT : undefined;
}

/**
 * The only pay-method identifiers we accept. Discovered empirically from
 * Bybit's `/fiat/otc/item/online` response for LKR: every ad uses pay-id
 * `"14"` (Bank Transfer). Anything else (mobile top-up, airtime, gift cards)
 * is out of scope.
 *
 * Bybit publishes only a numeric id on each ad; the human label is resolved
 * here so the UI doesn't need a separate dictionary.
 */
export const BANK_TRANSFER_IDS = ["14"] as const;
export type BankTransferId = (typeof BANK_TRANSFER_IDS)[number];

export const BANK_TRANSFER_OPTIONS: { id: BankTransferId; label: string }[] = [
  { id: "14", label: "Bank Transfer (Sri Lanka)" },
];

/**
 * Resolve the filter bar's payType selection into the list we actually pass
 * to Bybit. Empty string means "all bank rails" — currently a one-element list.
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
  LKR: BANK_TRANSFER_OPTIONS.slice(),
};

export const MERCHANT_TYPES = [
  { id: "merchant", label: "Verified merchants" },
  { id: "all", label: "All publishers" },
] as const;

export type MerchantTypeId = (typeof MERCHANT_TYPES)[number]["id"];
