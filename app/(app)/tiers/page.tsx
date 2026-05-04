import { Topbar } from "@/components/shell/topbar";
import { SectionHeader } from "@/components/common/section-header";
import { LiveDot } from "@/components/common/live-dot";
import { TiersBoard } from "@/components/tiers/tiers-board";
import { Empty } from "@/components/common/empty";
import { CloudOff } from "lucide-react";
import {
  ASSET,
  FIAT,
  PAYMENT_LABEL,
  TIER_AMOUNTS_USD,
  resolveBankPayTypes,
} from "@/lib/constants";
import { fetchBybitP2P, normalizeAds } from "@/lib/bybit";
import type { NormalizedAd, TradeType } from "@/lib/types";
import type { TierBlock, TiersResponse } from "@/lib/tiers-types";

export const metadata = {
  title: "Top Sellers — Best rates per ticket size",
  description:
    "Best Bybit Wise USD rates for $10, $50, $100, $300, $500 and $1,000 tickets — refreshed every 30s.",
};

export const revalidate = 30;

function median(ns: number[]): number | null {
  if (!ns.length) return null;
  const s = [...ns].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function sortBySideBest(ads: NormalizedAd[], side: TradeType): NormalizedAd[] {
  return [...ads].sort((a, b) =>
    side === "BUY" ? b.price - a.price : a.price - b.price,
  );
}

async function buildBlock(
  amount: number,
  side: TradeType,
  payTypes: string[],
): Promise<TierBlock> {
  let ads: NormalizedAd[] = [];
  try {
    const raw = await fetchBybitP2P({
      asset: ASSET,
      fiat: FIAT.code,
      tradeType: side,
      payTypes,
      transAmount: String(amount),
      rows: 20,
      page: 1,
    });
    ads = normalizeAds(raw, side);
  } catch {
    ads = [];
  }
  const sorted = sortBySideBest(ads, side);
  return {
    amount,
    side,
    bestPrice: sorted[0]?.price ?? null,
    medianPrice: median(sorted.map((a) => a.price)),
    totalCount: sorted.length,
    ads: sorted.slice(0, 5),
  };
}

export default async function TiersPage() {
  const payTypes = resolveBankPayTypes("");
  let initial: TiersResponse | null = null;
  try {
    const buy = await Promise.all(
      TIER_AMOUNTS_USD.map((a) => buildBlock(a, "BUY", payTypes)),
    );
    const sell = await Promise.all(
      TIER_AMOUNTS_USD.map((a) => buildBlock(a, "SELL", payTypes)),
    );
    initial = {
      asset: ASSET,
      fiat: FIAT.code,
      fetchedAt: new Date().toISOString(),
      tiers: { buy, sell },
    };
  } catch {
    initial = null;
  }

  const subtitle = `${ASSET} / ${FIAT.code} · ${PAYMENT_LABEL}`;

  return (
    <>
      <Topbar title="Top sellers per ticket size" subtitle={subtitle}>
        <LiveDot label="Live" className="hidden sm:inline-flex" />
      </Topbar>

      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <SectionHeader
          kicker="Best rate per ticket"
          title="Top Wise sellers — by ticket size"
          description={`Best Bybit P2P rates for the most common ticket sizes — $10, $50, $100, $300, $500 and $1,000 — for both directions. Switch the tab to see who has the best price for what you actually want to do. Refreshed every 30s.`}
        />

        {initial ? (
          <TiersBoard initial={initial} />
        ) : (
          <Empty
            icon={CloudOff}
            title="Couldn't reach Bybit P2P"
            description="The public P2P endpoint rejected our request or is temporarily unavailable. Refresh in a few seconds."
            tone="warn"
          />
        )}
      </div>
    </>
  );
}
