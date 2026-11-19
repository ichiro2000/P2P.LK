import { pageMetadata } from "@/lib/seo";
import { Clock } from "lucide-react";
import { Topbar } from "@/components/shell/topbar";
import { LiveDot } from "@/components/common/live-dot";
import { MarketStar } from "@/components/workspace/star-button";
import { Empty } from "@/components/common/empty";
import { KpiCard } from "@/components/common/kpi-card";
import { KpiGrid, PageBody, PageHeader } from "@/components/common/page";
import { RangeTabs } from "@/components/historical/range-tabs";
import { HistoryCharts } from "@/components/historical/history-charts";
import { getExchange } from "@/lib/exchanges";
import { getActiveExchange } from "@/lib/exchange-server";
import { freshness, listTrackedMarkets, parseRange } from "@/lib/db/queries";
import { downsampleBy, historyBundle } from "@/lib/history";
import { marketRegime, type Regime } from "@/lib/regime";
import { bestTime, type BestTime } from "@/lib/best-time";
import { RegimeBadge } from "@/components/historical/regime-badge";
import { BestTimeCard } from "@/components/historical/best-time";
import { AsOf } from "@/components/common/as-of";
import { gateRange } from "@/lib/member-gate";
import { ASSET, FIAT } from "@/lib/constants";
import { formatCompact, formatFiat, formatPct, formatSLT } from "@/lib/format";

export const metadata = pageMetadata({
  title: "USDT/LKR Price History: Binance & Bybit P2P Charts",
  description: "USDT to LKR price history from Binance P2P and Bybit P2P: best bid and ask, spread and order-book depth recorded every minute, with candles and hourly rollups.",
  path: "/historical",
});
export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;

const CANDLE_LABEL: Record<string, string> = {
  "300": "5 min",
  "900": "15 min",
  "3600": "1 hour",
  "10800": "3 hours",
  "43200": "12 hours",
};

export default async function HistoricalPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const ex = await getActiveExchange();
  const adapter = getExchange(ex);
  // 7d/30d are members only: guests get 24h, decided on the server.
  const { range, member } = await gateRange(parseRange(sp.range), "24h");

  const [bundle, tracked, regime, best] = await Promise.all([
    historyBundle(ex, ASSET, FIAT.code, range),
    listTrackedMarkets(ex, "30d"),
    marketRegime(ex, ASSET, FIAT.code).catch((err): Regime | null => {
      console.error("[historical] regime", err);
      return null;
    }),
    bestTime(ex, ASSET, FIAT.code).catch((err): BestTime | null => {
      console.error("[historical] best time", err);
      return null;
    }),
  ]);
  const { points, summary, candles, compare } = bundle;
  const otherLabel = compare ? getExchange(compare.exchange).label : ex === "binance" ? "Bybit" : "Binance";

  const symbol = FIAT.symbol;
  const mids = points.map((p) => p.mid).filter((v): v is number => v != null);
  const firstMid = mids[0];
  const lastMid = mids[mids.length - 1];
  const change = firstMid != null && lastMid != null ? (lastMid - firstMid) / firstMid : null;
  const fresh = freshness(bundle.latestTs);
  const hasData = points.some((p) => p.samples > 0);
  // Latest bucket that has data (the grid runs to now, so the very last
  // bucket can be empty for a minute).
  const latest = [...points].reverse().find((p) => p.samples > 0);
  const sparkOf = (k: "mid" | "spreadPct" | "askDepth1") => downsampleBy(points, 48, (p) => p[k]).map((p) => p[k]);

  return (
    <>
      <Topbar title="Historical" subtitle={`${ASSET} / ${FIAT.code} · ${adapter.label}`}>
        <MarketStar asset={ASSET} fiat={FIAT.code} />
        <LiveDot label="Ingesting" className="hidden sm:inline-flex" />
      </Topbar>

      <PageBody>
        <PageHeader
          eyebrow={`${adapter.label} · time series`}
          title={`${ASSET}/${FIAT.code} over ${range}`}
          description="Prices, spread and depth recorded every minute, in Sri Lanka time. Long ranges use hourly rollups. Gaps mean no data was recorded. Switch to candles, or overlay the other exchange."
          actions={<RangeTabs value={range} member={member} />}
        />

        {regime && <RegimeBadge regime={regime} />}

        {!hasData ? (
          <Empty
            icon={Clock}
            title={`No ${adapter.label} history for ${range} yet`}
            description={
              tracked.length === 0
                ? "The collector hasn't stored any snapshots for this exchange yet. Data appears within a minute of the first run."
                : "Nothing was recorded in this window. Try a longer range."
            }
          />
        ) : (
          <>
            <KpiGrid>
              <KpiCard
                label="Mid now"
                value={lastMid != null ? formatFiat(lastMid, symbol, 2) : "—"}
                change={change}
                changeLabel={range}
                sub={<AsOf ts={bundle.latestTs} stale={fresh.stale} />}
                spark={sparkOf("mid")}
              />
              <KpiCard
                label={`${range} average`}
                value={summary.avgMid != null ? formatFiat(summary.avgMid, symbol, 2) : "—"}
                sub={
                  summary.minMid != null && summary.maxMid != null
                    ? `${formatFiat(summary.minMid, symbol, 2)} – ${formatFiat(summary.maxMid, symbol, 2)}`
                    : undefined
                }
              />
              <KpiCard
                label="Average spread"
                value={summary.avgSpreadPct != null ? formatPct(summary.avgSpreadPct, { frac: 2 }) : "—"}
                sub={latest?.spreadPct != null ? `now ${formatPct(latest.spreadPct, { frac: 2 })}` : undefined}
                spark={sparkOf("spreadPct")}
                sparkTone="neutral"
              />
              <KpiCard
                label="Sell ads within 1%"
                value={summary.avgAskDepth1 != null ? `${formatCompact(summary.avgAskDepth1)} ${ASSET}` : "—"}
                sub={
                  summary.avgBidDepth1 != null
                    ? `${range} avg · buy ads ${formatCompact(summary.avgBidDepth1)} (declared)`
                    : "near-price depth is new; no history yet"
                }
                spark={sparkOf("askDepth1")}
                sparkTone="neutral"
              />
            </KpiGrid>

            <HistoryCharts
              key={`${ex}-${range}-${points.length}`}
              points={points.map((p) => ({
                ts: p.ts,
                bid: p.bid,
                ask: p.ask,
                mid: p.mid,
                spreadPct: p.spreadPct,
                bidDepth: p.bidDepth,
                askDepth: p.askDepth,
                bidDepth1: p.bidDepth1,
                askDepth1: p.askDepth1,
                bidDepth05: p.bidDepth05,
                askDepth05: p.askDepth05,
              }))}
              ma={bundle.ma}
              compare={compare?.points ?? null}
              candles={candles}
              exLabel={adapter.label}
              otherLabel={otherLabel}
              asset={ASSET}
              candleLabel={CANDLE_LABEL[String(bundle.candleSec)] ?? `${bundle.candleSec / 60} min`}
            />

            <p className="text-[11px] text-muted-foreground">
              {formatCompactCount(summary.count)} samples · {points.length} points ({bucketLabel(bundle.bucketSec)}) since{" "}
              {formatSLT(points[0]?.ts)} SLT
            </p>

            {best && <BestTimeCard data={best} exLabel={adapter.label} />}
          </>
        )}
      </PageBody>
    </>
  );
}

function bucketLabel(sec: number) {
  return sec < 3600 ? `${sec / 60}-min` : `${sec / 3600}-hour`;
}

function formatCompactCount(n: number) {
  return n >= 10_000 ? formatCompact(n) : String(n);
}
