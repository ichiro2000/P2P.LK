/**
 * P2P fees, as Binance publishes them for verified merchants.
 *
 *  - Takers (you answer someone's ad) pay no trading fee.
 *  - Makers (you post the ad) pay a maker fee on each filled order, in the
 *    crypto. Binance's LKR/USDT base rate is 0.10 % per side.
 *  - Verified-merchant levels get a discount on that rate:
 *      Bronze 20 %  → 0.080 %
 *      Silver 30 %  → 0.070 %
 *      Gold   50 %  → 0.050 %
 *    ("if the maker fee is 0.1 %, Silver pays 0.1 × (1 − 0.30) = 0.070 %").
 *  - The fee page also lists a fixed amount per order (0.07 USDT on USDT):
 *    modelled here as a MINIMUM fee per filled order, so small orders cost
 *    max(rate × amount, 0.07 USDT).
 *
 * All of this is a user setting (base rate, level, minimum), defaulted to
 * Binance's published numbers — never presented as the user's actual fee.
 */

export const MERCHANT_LEVELS = ["none", "bronze", "silver", "gold"] as const;
export type MerchantLevel = (typeof MERCHANT_LEVELS)[number];

export const LEVEL_LABEL: Record<MerchantLevel, string> = {
  none: "Not a merchant",
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
};

/** Fee rebate / discount per verified-merchant level (Binance). */
export const LEVEL_DISCOUNT: Record<MerchantLevel, number> = {
  none: 0,
  bronze: 0.2,
  silver: 0.3,
  gold: 0.5,
};

/** Binance LKR/USDT maker fee before level discounts, as a fraction. */
export const DEFAULT_BASE_MAKER_FEE = 0.001;
/** Fixed amount per filled order shown on the fee page (USDT). */
export const DEFAULT_MIN_FEE_USDT = 0.07;
/** Takers pay no trading fee on Binance/Bybit P2P. */
export const TAKER_FEE = 0;

export type FeeSettings = {
  level: MerchantLevel;
  /** Base maker fee, fraction (0.001 = 0.1 %). */
  baseMakerFee: number;
  /** Minimum fee per filled order, USDT. */
  minFeeUsdt: number;
};

export const DEFAULT_FEE_SETTINGS: FeeSettings = {
  level: "none",
  baseMakerFee: DEFAULT_BASE_MAKER_FEE,
  minFeeUsdt: DEFAULT_MIN_FEE_USDT,
};

/** Effective maker fee rate after the level discount. */
export function makerFeeRate(s: Pick<FeeSettings, "level" | "baseMakerFee">): number {
  const base = Number.isFinite(s.baseMakerFee) && s.baseMakerFee >= 0 ? s.baseMakerFee : DEFAULT_BASE_MAKER_FEE;
  return base * (1 - LEVEL_DISCOUNT[s.level]);
}

/**
 * Fee in USDT for posting-side fills of `usdt` spread over `orders` orders:
 * each order pays max(rate × size, minimum).
 */
export function makerFeeUsdt(usdt: number, orders: number, s: FeeSettings): number {
  if (!(usdt > 0)) return 0;
  const n = Math.max(1, Math.round(orders || 1));
  const perOrder = usdt / n;
  const min = Number.isFinite(s.minFeeUsdt) && s.minFeeUsdt > 0 ? s.minFeeUsdt : 0;
  return n * Math.max(perOrder * makerFeeRate(s), min);
}

/** Fee as a fraction of the amount (≥ the rate when the minimum bites). */
export function effectiveMakerFee(usdt: number, orders: number, s: FeeSettings): number {
  return usdt > 0 ? makerFeeUsdt(usdt, orders, s) / usdt : makerFeeRate(s);
}

/** How many orders a capital fills, given the order size the ad allows. */
export function ordersFor(capitalLkr: number, maxOrderLkr: number): number {
  if (!(capitalLkr > 0)) return 1;
  return maxOrderLkr > 0 ? Math.max(1, Math.ceil(capitalLkr / maxOrderLkr)) : 1;
}

/** Map an exchange vipLevel (1/2/3) to a merchant level. */
export function levelFromVip(vip: number | null | undefined): MerchantLevel {
  return vip === 3 ? "gold" : vip === 2 ? "silver" : vip === 1 ? "bronze" : "none";
}

export const pctText = (fraction: number, frac = 3) => `${(fraction * 100).toFixed(frac)}%`;
