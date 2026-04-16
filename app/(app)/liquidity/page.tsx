import { Topbar } from "@/components/shell/topbar";
import { SectionHeader } from "@/components/common/section-header";
import { LiveDot } from "@/components/common/live-dot";
import { MarketStar } from "@/components/workspace/star-button";
import { Reveal } from "@/components/common/reveal";
import { Card, CardContent } from "@/components/ui/card";
import { Stat } from "@/components/common/stat";
import { FilterBar, type FilterState } from "@/components/market/filter-bar";
import { SlippageSimulator } from "@/components/liquidity/slippage-simulator";
import { ConcentrationPanel } from "@/components/liquidity/concentration-panel";
import { DepthHeatmap } from "@/components/liquidity/depth-heatmap";
import { DepthTrend } from "@/components/liquidity/depth-trend";
import { Empty } from "@/components/common/empty";
import { CloudOff } from "lucide-react";
import { fetchBothSides, normalizeAds } from "@/lib/binance";
import { buildMarket } from "@/lib/analytics";
import { concentrationByMerchant } from "@/lib/liquidity";
import {
  depthHeatmap,
  listMarketSnapshots,
  marketSummary,
  RANGES,
  type RangeKey,
} from "@/lib/db/queries";
import { ASSETS, FIATS, getFiat } from "@/lib/constants";
import { formatCompact, formatFiat } from "@/lib/format";
import { RangeTabs } from "@/components/historical/range-tabs";

export const metadata = { title: "Liquidity" };
export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;

function parseFilters(
  sp: Record<string, string | string[] | undefined>,
): FilterState {
  const asset = String(sp.asset ?? "USDT").toUpperCase();
  const fiat = String(sp.fiat ?? "LKR").toUpperCase();
  return {
    asset: (ASSETS as readonly string[]).includes(asset) ? asset : "USDT",
    fiat: FIATS.some((f) => f.code === fiat) ? fiat : "LKR",
    payType: "",
    merchantType: "all",
  };
}

export default async function LiquidityPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const rangeKey = String(sp.range ?? "24h") as RangeKey;
  const range: RangeKey = rangeKey in RANGES ? rangeKey : "24h";

  const fiatMeta = getFiat(filters.fiat);
  const symbol = fiatMeta?.symbol ?? filters.fiat;
  const subtitle = `${filters.asset} / ${filters.fiat}${fiatMeta ? ` · ${fiatMeta.name}` : ""}`;

  // Live ads for concentration & slippage
  let concentrationSell = null;
  let concentrationBuy = null;
  let liveOk = true;
  try {
    const { buy, sell } = await fetchBothSides({
      asset: filters.asset,
      fiat: filters.fiat,
      rows: 20,
      publisherType: null,
    });
    const ads = [
      ...normalizeAds(buy, "BUY"),
      ...normalizeAds(sell, "SELL"),
    ];
    const market = buildMarket(filters.asset, filters.fiat, ads);
    concentrationSell = concentrationByMerchant(market.ads, "SELL", "fiat");
    concentrationBuy = concentrationByMerchant(market.ads, "BUY", "fiat");
  } catch {
    liveOk = false;
  }

  const [snapshots, summary, heatmap] = await Promise.all([
    listMarketSnapshots(filters.asset, filters.fiat, range),
    marketSummary(filters.asset, filters.fiat, range),
    depthHeatmap(filters.asset, filters.fiat, "30d"),
  ]);

  const latest = snapshots[snapshots.length - 1];
  const totalLatest =
    (latest?.bidDepth ?? 0) + (latest?.askDepth ?? 0);
  const totalAvg =
    summary?.avgBidDepth != null && summary?.avgAskDepth != null
      ? summary.avgBidDepth + summary.avgAskDepth
      : null;

  const depthDelta =
    totalAvg != null && totalAvg > 0
      ? (totalLatest - totalAvg) / totalAvg
      : null;

  return (
    <>
      <Topbar title="Liquidity" subtitle={subtitle}>
        <MarketStar asset={filters.asset} fiat={filters.fiat} />
        <LiveDot label="Live" className="hidden sm:inline-flex" />
      </Topbar>

      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <SectionHeader
          kicker="Liquidity analytics"
          title={`Can you actually fill size in ${filters.asset}/${filters.fiat}?`}
          description="Book walker for precise slippage on a target amount, merchant-concentration metrics (HHI + top-N share), and historical depth trends aggregated from the ingest pipeline."
          right={<RangeTabs value={range} />}
        />

        <FilterBar initial={filters} />

        {!liveOk && snapshots.length === 0 ? (
          <Empty
            icon={CloudOff}
            title="Couldn't reach Binance P2P"
            description="Live book can't be fetched and no historical data is available for this market yet."
            tone="warn"
          />
        ) : (
          <>
            <Reveal>
              <Card className="border-border bg-card/60">
                <CardContent className="grid grid-cols-2 gap-x-6 gap-y-5 p-5 md:grid-cols-4">
                  <Stat
                    label="Current depth"
                    value={
                      latest?.bidDepth != null || latest?.askDepth != null
                        ? `${formatCompact(totalLatest)} ${filters.asset}`
                        : "—"
                    }
                    delta={
                      depthDelta != null
                        ? {
                            value: depthDelta,
                            format: "pct",
                            tone: depthDelta < -0.15 ? "sell" : "buy",
                          }
                        : undefined
                    }
                    footnote={`vs ${range} average`}
                  />
                  <Stat
                    label="Average depth"
                    value={
                      totalAvg != null
                        ? `${formatCompact(totalAvg)} ${filters.asset}`
                        : "—"
                    }
                    footnote={`${snapshots.length} ticks`}
                  />
                  <Stat
                    label="Fiat book"
                    value={
                      concentrationSell && concentrationBuy
                        ? formatFiat(
                            concentrationSell.total + concentrationBuy.total,
                            symbol,
                            0,
                          )
                        : "—"
                    }
                    footnote="BID + ASK notional"
                  />
                  <Stat
                    label="Concentration (ASK)"
                    value={
                      concentrationSell
                        ? concentrationSell.hhi.toFixed(3)
                        : "—"
                    }
                    footnote={
                      concentrationSell
                        ? concentrationSell.hhi >= 0.25
                          ? "HHI · highly concentrated"
                          : "HHI · competitive"
                        : undefined
                    }
                  />
                </CardContent>
              </Card>
            </Reveal>

            {liveOk && (
              <Reveal delay={70}>
                <SlippageSimulator
                  asset={filters.asset}
                  fiat={filters.fiat}
                />
              </Reveal>
            )}

            {liveOk && concentrationSell && concentrationBuy && (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Reveal delay={110}>
                  <ConcentrationPanel
                    stats={concentrationSell}
                    symbol={symbol}
                    title="Concentration · ASK"
                    subtitle="Who holds the sell-side liquidity"
                  />
                </Reveal>
                <Reveal delay={140}>
                  <ConcentrationPanel
                    stats={concentrationBuy}
                    symbol={symbol}
                    title="Concentration · BID"
                    subtitle="Who holds the buy-side liquidity"
                  />
                </Reveal>
              </div>
            )}

            <Reveal delay={180}>
              <DepthTrend
                points={snapshots.map((s) => ({
                  ts: s.ts,
                  bidDepth: s.bidDepth,
                  askDepth: s.askDepth,
                }))}
                asset={filters.asset}
              />
            </Reveal>

            <Reveal delay={220}>
              <DepthHeatmap
                cells={heatmap.cells}
                max={heatmap.max}
                totalPoints={heatmap.totalPoints}
                asset={filters.asset}
              />
            </Reveal>
          </>
        )}
      </div>
    </>
  );
}
