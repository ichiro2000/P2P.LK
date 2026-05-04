/**
 * Client-safe types for the tiers feature. The API route at
 * `app/api/tiers/route.ts` re-exports the same types so old imports keep
 * working while the route's own server-only deps stay out of client bundles.
 */

import type { NormalizedAd, TradeType } from "@/lib/types";

export type TierBlock = {
  amount: number;
  side: TradeType;
  bestPrice: number | null;
  medianPrice: number | null;
  totalCount: number;
  ads: NormalizedAd[];
};

export type TiersResponse = {
  asset: string;
  fiat: string;
  fetchedAt: string;
  tiers: { buy: TierBlock[]; sell: TierBlock[] };
};
