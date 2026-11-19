import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, UserX } from "lucide-react";
import { Topbar } from "@/components/shell/topbar";
import { PageBody, PageSection } from "@/components/common/page";
import { KpiCard } from "@/components/common/kpi-card";
import { LiveDot } from "@/components/common/live-dot";
import { Empty } from "@/components/common/empty";
import { MerchantHeaderCard } from "@/components/merchant/detail/header-card";
import { RangeSelect } from "@/components/merchant/detail/range-select";
import { UptimeStrip } from "@/components/merchant/detail/activity-panels";
import {
  ActivityByHourChart,
  AdCountChart,
  CompletionGauge,
  DepthChart,
  GapChart,
  OrdersTrendChart,
  PriceVsMarketChart,
  type MerchantPoint,
} from "@/components/merchant/detail/merchant-charts";
import {
  RANGES,
  getMerchant,
  latestSweepTs,
  listMarketSnapshots,
  merchantActivityHours,
  merchantHistory,
  parseRange,
} from "@/lib/db/queries";
import { merchantStability } from "@/lib/db/insights";
import { classifyShowcase } from "@/lib/market-insights";
import { getActiveExchange } from "@/lib/exchange-server";
import { gateRange } from "@/lib/member-gate";
import { DEFAULT_EXCHANGE, getExchange } from "@/lib/exchanges";
import { ASSET, FIAT, SLT_OFFSET_SEC } from "@/lib/constants";
import { formatFiat, formatPct, formatCount } from "@/lib/format";
import { ACTIVE_SLACK_SEC, sideGaps } from "@/lib/analytics";
import { reliabilityScore } from "@/lib/merchant-score";
import { reliabilityInputs, twoSidedPrices } from "@/lib/db/merchant-directory";
import { medianOwnSpread, ownSpread } from "@/lib/competitors";
import { NetOwnSpread, SpreadMedianText } from "@/components/merchant/own-spread";
import { CompetitorSection, CompetitorSectionSkeleton } from "@/components/merchant/detail/compare-section";
import { ReliabilityInfo } from "@/components/merchant/reliability-info";
import { MerchantTradeSection, MerchantTradeSectionSkeleton } from "@/components/merchant/detail/trade-section";
import { JsonLd, breadcrumbJsonLd } from "@/components/seo/json-ld";
import { merchantName } from "@/lib/db/seo";
import { NOINDEX, pageMetadata } from "@/lib/seo";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;

/**
 * Title and description from one primary-key read (name only). The exchange
 * comes from the visitor's cookie, and crawlers have none, so they always
 * render the default exchange. A merchant from the other exchange is
 * `noindex` (Googlebot would see "not found" at that URL), as is any id we
 * have never seen.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const ex = await getActiveExchange();
  const adapter = getExchange(ex);
  const m = await merchantName(ex, id, ASSET, FIAT.code).catch(() => null);
  if (!m) return { title: "Merchant not found", robots: NOINDEX };
  const meta = pageMetadata({
    title: `${m.name}: ${adapter.label} P2P Merchant (USDT/LKR)`,
    description: `${m.name} on ${adapter.label} P2P Sri Lanka: live USDT/LKR buy and sell ads, completion rate, 30-day orders, reliability score and price history vs the market.`,
    path: `/merchants/${encodeURIComponent(id)}`,
  });
  return ex === DEFAULT_EXCHANGE ? meta : { ...meta, robots: NOINDEX };
}

/** SLT hour of day (half-hour offset rounded down, like the heatmap query). */
const sltHour = (ts: number) => Math.floor(((ts + SLT_OFFSET_SEC) % 86400) / 3600);

type MarketRow = Awaited<ReturnType<typeof listMarketSnapshots>>[number];
type HistoryRow = Awaited<ReturnType<typeof merchantHistory>>[number];

/** One row per tick; market values forward-filled, merchant values null
 *  when they weren't listing so gaps stay visible. */
function mergeSeries(
  allTs: number[],
  marketByTs: Map<number, MarketRow>,
  merchantByTs: Map<number, HistoryRow>,
): MerchantPoint[] {
  let bid: number | null = null;
  let ask: number | null = null;
  let mid: number | null = null;
  const out: MerchantPoint[] = [];
  for (const ts of allTs) {
    const mk = marketByTs.get(ts);
    if (mk) {
      bid = mk.bestBid ?? bid;
      ask = mk.bestAsk ?? ask;
      mid = mk.mid ?? mid;
    }
    const mr = merchantByTs.get(ts);
    const bidPx = mr?.bestBuyPrice ?? null;
    const askPx = mr?.bestSellPrice ?? null;
    out.push({
      t: ts * 1000,
      bidPx,
      askPx,
      mid,
      sellGap: askPx != null && ask ? Math.max(0, (askPx - ask) / ask) : null,
      buyGap: bidPx != null && bid ? Math.max(0, (bid - bidPx) / bid) : null,
      depth: mr?.totalAvailableFiat ?? null,
      buyAds: mr ? (mr.buyAds ?? 0) : null,
      sellAds: mr ? (mr.sellAds ?? 0) : null,
      orders: mr?.ordersMonth ?? null,
    });
  }
  return out;
}

export default async function MerchantDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SP;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { range, member } = await gateRange(parseRange(sp.range), "24h");
  const ex = await getActiveExchange();
  const adapter = getExchange(ex);
  const asset = ASSET;
  const fiat = FIAT.code;
  const sym = FIAT.symbol;
  const subtitle = `${asset} / ${fiat} · ${adapter.label} P2P`;

  const [latest, history, market, sweepTs, activityHours, stability, relInputs, twoSided] = await Promise.all([
    getMerchant(ex, id, asset, fiat),
    merchantHistory(ex, id, asset, fiat, range).catch(() => []),
    listMarketSnapshots(ex, asset, fiat, range).catch(() => []),
    latestSweepTs(ex, asset, fiat).catch(() => null),
    merchantActivityHours(ex, id, asset, fiat).catch(() => []),
    merchantStability(ex, asset, fiat, { merchantIds: [id] }).catch(() => []),
    reliabilityInputs(ex, asset, fiat, [id]).catch(() => null),
    twoSidedPrices(ex, asset, fiat).catch(() => []),
  ]);

  if (!latest) {
    return (
      <>
        <Topbar title="Merchant not found" subtitle={subtitle} />
        <PageBody width="narrow">
          <Empty
            icon={UserX}
            title="We haven't seen this merchant"
            description={`No records for advertiser ${id} on ${asset}/${fiat} at ${adapter.label}. They may never have listed on LKR bank transfers, or they trade on the other exchange.`}
            tone="warn"
            action={
              <Link href="/merchants" className="inline-flex h-10 items-center text-sm underline underline-offset-4">
                Back to all merchants
              </Link>
            }
          />
        </PageBody>
      </>
    );
  }

  /* ── Merge merchant and market series ──────────────────────────────── */
  // Merchants are sampled by the 5-minute sweep; for short ranges only
  // sweep-aligned market ticks are kept so presence isn't understated.
  const short = RANGES[range] <= RANGES["24h"];
  const marketRows = short ? market.filter((r) => r.ts % 300 === 0) : market;
  const marketByTs = new Map(marketRows.map((r) => [r.ts, r]));
  const merchantByTs = new Map(history.map((r) => [r.ts, r]));
  const allTs = [...new Set([...marketByTs.keys(), ...merchantByTs.keys()])].sort((a, b) => a - b);

  const points = mergeSeries(allTs, marketByTs, merchantByTs);

  /* ── Activity by hour ───────────────────────────────────────────────── */
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, sweeps: 0 }));
  let hourSource = "last 30 days";
  if (activityHours.length > 0) {
    for (const h of activityHours) hours[sltHour(h.ts)].sweeps += h.samples;
  } else {
    // Hourly rollups not written yet — fall back to raw sweeps in range.
    hourSource = `this ${range}`;
    for (const r of history) hours[sltHour(r.ts)].sweeps += 1;
  }

  /* ── Header + KPIs ─────────────────────────────────────────────────── */
  const activeNow = sweepTs != null && latest.lastSeenTs >= sweepTs - ACTIVE_SLACK_SEC;
  const showcase = stability[0] ? classifyShowcase(stability[0]) : null;
  const rel = relInputs?.get(id);
  const reliability = reliabilityScore({
    completionRate: latest.completionRate,
    orders30d: latest.ordersMonth,
    presence7d: rel?.presence7d ?? null,
    firstSeenTs: rel?.firstSeenTs ?? latest.firstSeenTs ?? null,
    // Binance profile (release time, feedback, account age); null → rescaled.
    avgReleaseSec: rel?.avgReleaseSec ?? null,
    positive: rel?.positive ?? null,
    negative: rel?.negative ?? null,
    registerDays: rel?.registerDays ?? null,
  });
  const lastMarket = market.at(-1);
  const bestBuy = activeNow ? latest.bestBuyPrice : null;
  const bestSell = activeNow ? latest.bestSellPrice : null;
  // Per side, against the market's best on that side (F3).
  const { askGap, bidGap } = sideGaps(
    { bestSellPrice: bestSell, bestBuyPrice: bestBuy },
    { bestAsk: lastMarket?.bestAsk ?? null, bestBid: lastMarket?.bestBid ?? null },
  );
  const gapText = (g: number | null) => (g == null ? null : g < 0.00005 ? "at the best price" : `+${formatPct(g, { frac: 2 })} vs best`);
  const ordersSpark = points.map((p) => p.orders);
  const spread = ownSpread(bestSell, bestBuy);
  const spreadMedian = medianOwnSpread(twoSided);

  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Live markets", path: "/" },
          { name: "Merchants", path: "/merchants" },
          { name: latest.merchantName },
        ])}
      />
      <Topbar title={latest.merchantName} subtitle={subtitle}>
        <LiveDot label="Live" className="hidden sm:inline-flex" />
      </Topbar>

      <PageBody>
        <Link
          href="/merchants"
          className="-my-2 inline-flex h-10 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> All merchants
        </Link>

        <MerchantHeaderCard
          m={{
            id: latest.merchantId,
            name: latest.merchantName,
            isMerchant: Boolean(latest.isMerchant),
            userIdentity: latest.userIdentity ?? null,
            vipLevel: latest.vipLevel ?? null,
            isActive: activeNow,
            lastSeenTs: latest.lastSeenTs,
            profileUrl: adapter.profileUrl(latest.merchantId, asset, fiat),
            exchangeLabel: adapter.label,
            exchange: ex,
            asset,
            fiat,
            showcase,
          }}
        />

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <CompletionGauge rate={latest.completionRate} orders={latest.ordersMonth} />
          <div className="grid grid-cols-2 gap-3 lg:col-span-2">
            <KpiCard
              label="Their sell ad"
              value={formatFiat(bestSell, sym, 2)}
              tone={bestSell != null ? "buy" : undefined}
              sub={activeNow ? `${latest.sellAds ?? 0} sell ads live${askGap != null ? ` · ${gapText(askGap)}` : ""}` : "Not listing now"}
            />
            <KpiCard
              label="Their buy ad"
              value={formatFiat(bestBuy, sym, 2)}
              tone={bestBuy != null ? "sell" : undefined}
              sub={activeNow ? `${latest.buyAds ?? 0} buy ads live${bidGap != null ? ` · ${gapText(bidGap)}` : ""}` : "Not listing now"}
            />
            <KpiCard
              label="30-day orders"
              value={formatCount(latest.ordersMonth)}
              sub={`${formatPct(latest.completionRate, { frac: 1 })} completed`}
              spark={ordersSpark}
              sparkTone="neutral"
            />
            <KpiCard
              label="Reliability score"
              value={String(reliability.score)}
              sub={`0–100 · completion lower bound ${formatPct(reliability.parts.completionLB, { frac: 1 })}`}
              icon={<ReliabilityInfo parts={reliability.parts} className="-my-2" />}
            />
            <KpiCard
              className="col-span-2"
              label="Own spread (best Sell ad − best Buy ad)"
              value={spread ? formatFiat(spread.lkr, sym, 2) : activeNow ? "One side only" : "—"}
              sub={
                spread
                  ? `${formatPct(spread.pct, { frac: 2 })} of their mid ${formatFiat(spread.mid, sym, 2)}${spread.lkr < 0 ? " · crossed" : ""}`
                  : activeNow
                    ? "Needs both a Sell ad and a Buy ad live"
                    : "Not listing now"
              }
              footer={
                <span className="flex flex-col gap-1">
                  <SpreadMedianText
                    median={spreadMedian}
                    ask={spread ? bestSell : undefined}
                    bid={bestBuy}
                    scope="advertisers"
                  />
                  {spread && <NetOwnSpread ask={bestSell} bid={bestBuy} />}
                </span>
              }
            />
          </div>
        </div>

        <Suspense fallback={<CompetitorSectionSkeleton />}>
          <CompetitorSection exchange={ex} asset={asset} fiat={fiat} id={latest.merchantId} name={latest.merchantName} />
        </Suspense>

        <Suspense fallback={<MerchantTradeSectionSkeleton />}>
          <MerchantTradeSection
            exchange={ex}
            id={latest.merchantId}
            adOrders30d={latest.ordersMonth}
            adCompletion={latest.completionRate}
          />
        </Suspense>

        <PageSection
          title="History"
          description={`${history.length} merchant sweeps · ${marketRows.length} market points in ${range}`}
          actions={<RangeSelect value={range} member={member} />}
        >
          <div className="space-y-4">
            <PriceVsMarketChart points={points} />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <GapChart points={points} />
              <OrdersTrendChart points={points} />
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <DepthChart points={points} />
              <AdCountChart points={points} />
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <ActivityByHourChart hours={hours} source={hourSource} />
              <UptimeStrip
                marketTicks={marketRows.map((r) => r.ts)}
                merchantTicks={history.map((r) => r.ts)}
              />
            </div>
          </div>
        </PageSection>
      </PageBody>
    </>
  );
}
