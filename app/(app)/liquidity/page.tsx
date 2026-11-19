import { pageMetadata } from "@/lib/seo";
import { CloudOff } from "lucide-react";
import { Topbar } from "@/components/shell/topbar";
import { LiveDot } from "@/components/common/live-dot";
import { MarketStar } from "@/components/workspace/star-button";
import { Empty } from "@/components/common/empty";
import { KpiCard } from "@/components/common/kpi-card";
import { KpiGrid, PageBody, PageHeader, PageSection } from "@/components/common/page";
import { FilterBar, type FilterState } from "@/components/market/filter-bar";
import { RangeTabs } from "@/components/historical/range-tabs";
import { SlippageSimulator } from "@/components/liquidity/slippage-simulator";
import { ConcentrationPanel } from "@/components/liquidity/concentration-panel";
import { DepthHeatmap } from "@/components/liquidity/depth-heatmap";
import { DepthTrend } from "@/components/liquidity/depth-trend";
import { ActivityIndex } from "@/components/liquidity/activity-index";
import { getBook } from "@/lib/market-data";
import { getExchange, resolvePayTypes } from "@/lib/exchanges";
import { getActiveExchange } from "@/lib/exchange-server";
import { buildMarket } from "@/lib/analytics";
import { concentrationByMerchant, type ConcentrationStats } from "@/lib/liquidity";
import { depthHeatmap, freshness, parseRange } from "@/lib/db/queries";
import { gateRange } from "@/lib/member-gate";
import { downsampleBy, historyBundle } from "@/lib/history";
import { nearTouchImbalance } from "@/lib/near-touch";
import { AsOf } from "@/components/common/as-of";
import { activityIndex, type ActivityIndex as Activity } from "@/lib/activity";
import { ASSET, FIAT } from "@/lib/constants";
import { formatCompact, formatPct } from "@/lib/format";

export const metadata = pageMetadata({
  title: "USDT/LKR P2P Liquidity: Depth & Slippage by Hour",
  description: "How much USDT you can buy or sell for LKR on Binance P2P and Bybit P2P before the price moves: live fill simulator, depth by merchant and liquidity by hour.",
  path: "/liquidity",
});
export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;

function parseFilters(sp: Record<string, string | string[] | undefined>): FilterState {
  return {
    asset: ASSET,
    fiat: FIAT.code,
    payType: String(sp.payType ?? ""),
    merchantType: String(sp.merchantType ?? "merchant") === "all" ? "all" : "merchant",
  };
}

async function liveConcentration(
  ex: Awaited<ReturnType<typeof getActiveExchange>>,
  filters: FilterState,
): Promise<{ sell: ConcentrationStats; buy: ConcentrationStats } | null> {
  try {
    const book = await getBook(ex, {
      asset: filters.asset,
      fiat: filters.fiat,
      payTypes: resolvePayTypes(getExchange(ex), filters.payType),
    });
    const market = buildMarket(filters.asset, filters.fiat, [...book.buy, ...book.sell]);
    return {
      sell: concentrationByMerchant(market.ads, "SELL", "fiat"),
      buy: concentrationByMerchant(market.ads, "BUY", "fiat"),
    };
  } catch {
    return null;
  }
}

export default async function LiquidityPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const ex = await getActiveExchange();
  const adapter = getExchange(ex);
  const { range, member } = await gateRange(parseRange(sp.range), "24h");
  const symbol = FIAT.symbol;

  const [conc, bundle, heatmap, activity] = await Promise.all([
    liveConcentration(ex, filters),
    historyBundle(ex, filters.asset, filters.fiat, range, { compare: false }),
    depthHeatmap(ex, filters.asset, filters.fiat),
    activityIndex(ex, filters.asset, filters.fiat).catch((err): Activity | null => {
      console.error("[liquidity] activity index", err);
      return null;
    }),
  ]);
  const { points, summary } = bundle;
  const fresh = freshness(bundle.latestTs);
  const hasData = points.some((p) => p.samples > 0);

  // Near-touch depth (within 1 % of each side's best price). The last bucket
  // with a value is "now"; a stale feed is labelled as such.
  const lastWith = (k: "askDepth1" | "bidDepth1") => {
    for (let i = points.length - 1; i >= 0; i--) if (points[i][k] != null) return points[i][k];
    return null;
  };
  const askNow = lastWith("askDepth1");
  const bidNow = lastWith("bidDepth1");
  const askDelta = askNow != null && summary.avgAskDepth1 ? askNow / summary.avgAskDepth1 - 1 : null;
  const bidDelta = bidNow != null && summary.avgBidDepth1 ? bidNow / summary.avgBidDepth1 - 1 : null;
  const askSpark = downsampleBy(points, 48, (p) => p.askDepth1).map((p) => p.askDepth1);
  const bidSpark = downsampleBy(points, 48, (p) => p.bidDepth1).map((p) => p.bidDepth1);
  const balance = nearTouchImbalance(bidNow, askNow);

  return (
    <>
      <Topbar title="Liquidity" subtitle={`${ASSET} / ${FIAT.code} · ${adapter.label}`}>
        <MarketStar asset={filters.asset} fiat={filters.fiat} />
        <LiveDot label="Live" className="hidden sm:inline-flex" />
      </Topbar>

      <PageBody>
        <PageHeader
          eyebrow={`${adapter.label} · liquidity`}
          title={`Can you fill size in ${filters.asset}/${filters.fiat}?`}
          description="Simulate a fill against the live book, see who holds the depth, how busy the book is today, and when liquidity peaks."
          actions={<RangeTabs value={range} member={member} />}
        />

        <FilterBar initial={filters} payTypes={adapter.payMethods} />

        {!conc && !hasData ? (
          <Empty
            icon={CloudOff}
            title={`Couldn't reach ${adapter.label} P2P`}
            description="The live book can't be fetched and there's no stored history for this window yet."
            tone="warn"
          />
        ) : (
          <>
            <KpiGrid>
              <KpiCard
                label="Sell ads within 1%"
                value={askNow != null ? `${formatCompact(askNow)} ${ASSET}` : "—"}
                change={askDelta}
                changeLabel={`vs ${range}`}
                sub={<AsOf ts={bundle.latestTs} stale={fresh.stale} />}
                spark={askSpark}
                sparkTone="neutral"
              />
              <KpiCard
                label="Buy ads within 1%"
                value={bidNow != null ? `${formatCompact(bidNow)} ${ASSET}` : "—"}
                change={bidDelta}
                changeLabel={`vs ${range}`}
                sub="declared, not escrowed"
                spark={bidSpark}
                sparkTone="neutral"
              />
              <KpiCard
                label="Book balance ±1%"
                value={balance != null ? formatPct(balance, { frac: 0, sign: true }) : "—"}
                sub={
                  balance == null
                    ? "no near-price depth yet"
                    : balance > 0.1
                      ? "more (declared) buying"
                      : balance < -0.1
                        ? "more selling than buying"
                        : "balanced within 1%"
                }
              />
              <KpiCard
                label="HHI · Sell ads"
                value={conc ? conc.sell.hhi.toFixed(3) : "—"}
                sub={conc ? (conc.sell.hhi >= 0.25 ? "highly concentrated" : conc.sell.hhi >= 0.15 ? "moderate" : "competitive") : "live book unavailable"}
              />
            </KpiGrid>

            {conc && <SlippageSimulator asset={filters.asset} fiat={filters.fiat} exchange={ex} />}

            <PageSection
              title="Activity index"
              description="Last 24 hours vs the 24 hours before, Sri Lanka hours. Trade volume isn't public, so activity is an orders index."
            >
              {activity ? (
                <ActivityIndex data={activity} symbol={symbol} asset={filters.asset} />
              ) : (
                <Empty title="Activity index unavailable" description="Couldn't read merchant sweeps right now." />
              )}
            </PageSection>

            {conc && (
              <PageSection title="Concentration" description="Who holds the LKR on each side of the live book.">
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <ConcentrationPanel
                    stats={conc.sell}
                    symbol={symbol}
                    title="Sell ads"
                    subtitle="Liquidity you buy USDT from"
                  />
                  <ConcentrationPanel
                    stats={conc.buy}
                    symbol={symbol}
                    title="Buy ads"
                    subtitle="Liquidity you sell USDT to"
                  />
                </div>
              </PageSection>
            )}

            <DepthTrend
              points={points.map((p) => ({
                ts: p.ts,
                bidDepth1: p.bidDepth1,
                askDepth1: p.askDepth1,
                bidDepth05: p.bidDepth05,
                askDepth05: p.askDepth05,
                bidDepth: p.bidDepth,
                askDepth: p.askDepth,
              }))}
              asset={filters.asset}
            />

            <DepthHeatmap
              cells={heatmap.cells}
              maxAsk={heatmap.maxAsk}
              maxBid={heatmap.maxBid}
              totalPoints={heatmap.totalPoints}
              asset={filters.asset}
            />
          </>
        )}
      </PageBody>
    </>
  );
}
