import { Topbar } from "@/components/shell/topbar";
import { SectionHeader } from "@/components/common/section-header";
import { LiveDot } from "@/components/common/live-dot";
import { fetchBothSides, normalizeAds } from "@/lib/binance";
import { buildMarket } from "@/lib/analytics";
import { DEFAULT_ARB_FIATS } from "@/lib/constants";
import { ArbitragePanel } from "@/components/arbitrage/arbitrage-panel";
import type { MarketSnapshot } from "@/lib/types";

export const revalidate = 30;

export const metadata = {
  title: "Arbitrage",
  description:
    "Cross-market spread opportunities and within-market round-trip arbitrage on Binance P2P.",
};

export default async function ArbitragePage() {
  const asset = "USDT";
  const fiats = DEFAULT_ARB_FIATS;

  const snapshots: MarketSnapshot[] = await Promise.all(
    fiats.map(async (fiat) => {
      try {
        const { buy, sell } = await fetchBothSides({
          asset,
          fiat,
          rows: 10,
          publisherType: null,
        });
        const ads = [
          ...normalizeAds(buy, "BUY"),
          ...normalizeAds(sell, "SELL"),
        ];
        return buildMarket(asset, fiat, ads);
      } catch {
        return buildMarket(asset, fiat, []);
      }
    }),
  );

  return (
    <>
      <Topbar title="Arbitrage" subtitle="Within-market round-trip opportunities">
        <LiveDot label="Scanning" className="hidden sm:inline-flex" />
      </Topbar>

      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <SectionHeader
          kicker="Spread finder"
          title="Arbitrage across Binance P2P"
          description="Spot markets where the BUY bid and SELL ask are dislocated. Adjust the fee and slippage assumptions to see which opportunities survive after costs."
        />

        <ArbitragePanel
          initial={{ snapshots, fetchedAt: new Date().toISOString() }}
          asset={asset}
          fiats={fiats}
        />
      </div>
    </>
  );
}
