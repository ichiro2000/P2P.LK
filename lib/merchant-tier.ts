/**
 * Binance P2P merchant tier derivation.
 *
 * Mapping confirmed against Binance's live USDT/LKR feed (see
 * `scripts/probe-tier.ts`) + visual cross-check of their UI:
 *
 *   userType = "merchant" AND vipLevel = 1 → Bronze
 *   userType = "merchant" AND vipLevel = 2 → Silver
 *   userType = "merchant" AND vipLevel = 3 → Gold
 *   userType = "user"                       → no badge
 *
 * `userGrade` looks like a tier number (1/2/3) but is actually a
 * merchant-vs-user flag — every merchant in the feed has grade=3,
 * every user has grade=2. Don't use it for tier color.
 *
 * `userIdentity` is kept as metadata (BLOCK_MERCHANT is a premium
 * escalation Binance uses in other markets — currently absent from
 * LKR). If we ever see BLOCK_MERCHANT it's treated as gold.
 */

export type MerchantTier = "bronze" | "silver" | "gold";

export function deriveMerchantTier(args: {
  isMerchant?: boolean | null;
  userIdentity?: string | null;
  vipLevel?: number | null;
}): MerchantTier | null {
  const identity = (args.userIdentity ?? "").toUpperCase();
  const isMerchantFlag =
    args.isMerchant === true || /MERCHANT/.test(identity);

  if (!isMerchantFlag) return null;

  // BLOCK_MERCHANT is Binance's premium escalation — treat as gold even
  // if vipLevel happens to be low/missing.
  if (identity === "BLOCK_MERCHANT") return "gold";

  const vip = args.vipLevel ?? 0;
  if (vip >= 3) return "gold";
  if (vip === 2) return "silver";
  if (vip === 1) return "bronze";

  // Merchant flag is set but vipLevel is null/0 — happens on stale cached
  // rows written before we started persisting vipLevel. Show bronze rather
  // than nothing so the row doesn't regress from "verified" to "unknown".
  return "bronze";
}

export const TIER_LABEL: Record<MerchantTier, string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
};
