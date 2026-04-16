import { Topbar } from "@/components/shell/topbar";
import { SectionHeader } from "@/components/common/section-header";
import { LiveDot } from "@/components/common/live-dot";
import { Reveal } from "@/components/common/reveal";
import { Card, CardContent } from "@/components/ui/card";
import { Stat } from "@/components/common/stat";
import { MarketStar } from "@/components/workspace/star-button";
import {
  listMarketSnapshots,
  marketSummary,
  listTrackedMarkets,
  RANGES,
  type RangeKey,
} from "@/lib/db/queries";
import { ASSET, FIAT } from "@/lib/constants";
import { FilterBar, type FilterState } from "@/components/market/filter-bar";
import { PriceChart } from "@/components/historical/price-chart";
import { DepthChart } from "@/components/historical/depth-chart";
import { PriceDistribution } from "@/components/historical/price-distribution";
import { RangeTabs } from "@/components/historical/range-tabs";
import { Empty } from "@/components/common/empty";
import { Clock } from "lucide-react";
import { formatCompact, formatFiat, formatPct } from "@/lib/format";

export const metadata = { title: "Historical" };
export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;

function parseFilters(
  sp: Record<string, string | string[] | undefined>,
): FilterState {
  return {
    asset: ASSET,
    fiat: FIAT.code,
    payType: String(sp.payType ?? ""),
    merchantType: String(sp.merchantType ?? "all") === "merchant" ? "merchant" : "all",
  };
}

export default async function HistoricalPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const rangeKey = String(sp.range ?? "24h") as RangeKey;
  const range: RangeKey = rangeKey in RANGES ? rangeKey : "24h";

  const [snapshots, summary, tracked] = await Promise.all([
    listMarketSnapshots(filters.asset, filters.fiat, range),
    marketSummary(filters.asset, filters.fiat, range),
    listTrackedMarkets("30d"),
  ]);

  const symbol = FIAT.symbol;
  const subtitle = `${ASSET} / ${FIAT.code} · ${FIAT.name}`;

  const mids = snapshots
    .map((s) => s.mid)
    .filter((v): v is number => v != null);

  const latest = snapshots[snapshots.length - 1];
  const first = snapshots[0];

  const change =
    first?.mid != null && latest?.mid != null
      ? (latest.mid - first.mid) / first.mid
      : null;

  return (
    <>
      <Topbar title="Historical" subtitle={subtitle}>
        <MarketStar asset={filters.asset} fiat={filters.fiat} />
        <LiveDot label="Ingesting" className="hidden sm:inline-flex" />
      </Topbar>

      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <SectionHeader
          kicker="Time series"
          title={`${filters.asset}/${filters.fiat} over ${range}`}
          description="Prices, spreads and depth captured every few minutes by our ingest worker. Switch the range tabs to zoom out."
          right={<RangeTabs value={range} />}
        />

        <FilterBar initial={filters} />

        {snapshots.length === 0 ? (
          <Empty
            icon={Clock}
            title="No history for this market yet"
            description={
              tracked.length === 0
                ? "The ingest worker hasn't run. Start it with `npm run ingest:loop` to accumulate snapshots, or deploy and let Vercel Cron tick every 5 minutes."
                : `Tracked markets: ${tracked.map((t) => `${t.asset}/${t.fiat}`).join(", ")}. Switch the filter to one of those.`
            }
          />
        ) : (
          <>
            <Reveal>
              <Card className="border-border bg-card/60">
                <CardContent className="grid grid-cols-2 gap-x-6 gap-y-5 p-5 md:grid-cols-4">
                  <Stat
                    label="Current mid"
                    value={
                      latest?.mid != null
                        ? formatFiat(latest.mid, symbol, 2)
                        : "—"
                    }
                    delta={
                      change != null
                        ? { value: change, format: "pct" }
                        : undefined
                    }
                    footnote={`${snapshots.length} ticks in range`}
                  />
                  <Stat
                    label={`${range} average`}
                    value={
                      summary?.avgMid != null
                        ? formatFiat(summary.avgMid, symbol, 2)
                        : "—"
                    }
                    footnote={
                      summary?.minMid != null && summary?.maxMid != null
                        ? `${formatFiat(summary.minMid, symbol, 2)} – ${formatFiat(summary.maxMid, symbol, 2)}`
                        : undefined
                    }
                  />
                  <Stat
                    label="Average spread"
                    value={
                      summary?.avgSpreadPct != null
                        ? formatPct(summary.avgSpreadPct, { frac: 2 })
                        : "—"
                    }
                    footnote="Sell − Buy ads, mean"
                  />
                  <Stat
                    label="Average depth"
                    value={
                      summary?.avgBidDepth != null &&
                      summary?.avgAskDepth != null
                        ? `${formatCompact(summary.avgBidDepth + summary.avgAskDepth)} ${filters.asset}`
                        : "—"
                    }
                    footnote="Top-20 Buy + Sell ads"
                  />
                </CardContent>
              </Card>
            </Reveal>

            <Reveal delay={70}>
              <PriceChart
                points={snapshots.map((s) => ({
                  ts: s.ts,
                  bid: s.bestBid,
                  ask: s.bestAsk,
                  mid: s.mid,
                  spreadPct: s.spreadPct,
                  bidDepth: s.bidDepth,
                  askDepth: s.askDepth,
                }))}
                symbol={symbol}
                asset={filters.asset}
              />
            </Reveal>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Reveal delay={110}>
                <DepthChart
                  points={snapshots.map((s) => ({
                    ts: s.ts,
                    bid: s.bestBid,
                    ask: s.bestAsk,
                    mid: s.mid,
                    spreadPct: s.spreadPct,
                    bidDepth: s.bidDepth,
                    askDepth: s.askDepth,
                  }))}
                  asset={filters.asset}
                />
              </Reveal>
              <Reveal delay={140}>
                <PriceDistribution mids={mids} symbol={symbol} />
              </Reveal>
            </div>

            <div className="pt-1 text-[11px] text-muted-foreground">
              {snapshots.length} snapshots since{" "}
              {first ? new Date(first.ts * 1000).toLocaleString() : "—"}
            </div>
          </>
        )}
      </div>
    </>
  );
}
