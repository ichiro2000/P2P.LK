import { Topbar } from "@/components/shell/topbar";
import { SectionHeader } from "@/components/common/section-header";
import { LiveDot } from "@/components/common/live-dot";
import { RangeTabs } from "@/components/historical/range-tabs";
import { Reveal } from "@/components/common/reveal";
import { Empty } from "@/components/common/empty";
import { Clock, UserX } from "lucide-react";
import Link from "next/link";
import {
  latestMarketSnapshot,
  latestMerchantSnapshot,
  listMarketMids,
  merchantHistory,
  RANGES,
  type RangeKey,
} from "@/lib/db/queries";
import { ASSET, FIAT } from "@/lib/constants";
import { formatSLT } from "@/lib/format";
import {
  MerchantHeaderCard,
  type MerchantHeaderData,
} from "@/components/merchant/detail/header-card";
import {
  MerchantAdCountChart,
  MerchantDepthChart,
  MerchantPremiumChart,
  MerchantPriceChart,
  MerchantSpreadChart,
  type MerchantPoint,
} from "@/components/merchant/detail/merchant-charts";
import {
  HourHeatmap,
  UptimeStrip,
} from "@/components/merchant/detail/activity-panels";

export const metadata = { title: "Merchant detail" };
export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;

function trustScoreFor({
  completionRate,
  orders30d,
  avgReleaseSec,
}: {
  completionRate: number;
  orders30d: number;
  avgReleaseSec: number | null | undefined;
}): number {
  const completionPts = Math.max(0, Math.min(1, completionRate)) * 50;
  const ordersNorm = Math.min(
    1,
    Math.log10(Math.max(1, orders30d)) / Math.log10(2000),
  );
  const orderPts = ordersNorm * 30;
  const releasePts = (() => {
    if (avgReleaseSec == null) return 12;
    if (avgReleaseSec <= 60) return 20;
    if (avgReleaseSec <= 180) return 16;
    if (avgReleaseSec <= 300) return 12;
    if (avgReleaseSec <= 600) return 8;
    return 4;
  })();
  return Math.max(
    0,
    Math.min(100, Math.round(completionPts + orderPts + releasePts)),
  );
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
  const rangeKey = String(sp.range ?? "24h") as RangeKey;
  const range: RangeKey = rangeKey in RANGES ? rangeKey : "24h";

  const asset = ASSET;
  const fiat = FIAT.code;
  const symbol = FIAT.symbol;
  const subtitle = `${asset} / ${fiat} · ${FIAT.name}`;

  const [latest, history, marketMids, latestMarket] = await Promise.all([
    latestMerchantSnapshot(id, asset, fiat).catch(() => undefined),
    merchantHistory(id, asset, fiat, range).catch(() => []),
    listMarketMids(asset, fiat, range).catch(() => []),
    latestMarketSnapshot(asset, fiat).catch(() => undefined),
  ]);

  if (!latest) {
    return (
      <>
        <Topbar title="Merchant not found" subtitle={subtitle} />
        <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 py-8">
          <Empty
            icon={UserX}
            title="We haven't seen this merchant"
            description={`No snapshots for advertiser ${id} on ${asset}/${fiat}. They may have never listed on LKR bank transfers, or the ID is wrong.`}
            tone="warn"
            action={
              <Link
                href="/merchants"
                className="text-[12px] text-primary hover:underline"
              >
                ← Back to merchants directory
              </Link>
            }
          />
        </div>
      </>
    );
  }

  // Market-ticks in range (distinct ts) — used by uptime strip & hour heatmap.
  const marketTicks = marketMids.map((r) => r.ts);
  const merchantTicks = history.map((r) => r.ts);
  const activeNow =
    latestMarket != null && latest.ts === latestMarket.ts;

  // Build the merged time series. Every market tick gets a point; merchant
  // fields are null when they weren't listing that tick so gaps are visible.
  const marketMidByTs = new Map<number, number | null>();
  for (const r of marketMids) marketMidByTs.set(r.ts, r.mid);
  const merchantByTs = new Map<number, typeof history[number]>();
  for (const r of history) merchantByTs.set(r.ts, r);

  const tsUnion = Array.from(
    new Set<number>([...marketMidByTs.keys(), ...merchantByTs.keys()]),
  ).sort((a, b) => a - b);

  const points: MerchantPoint[] = tsUnion.map((ts) => {
    const mr = merchantByTs.get(ts);
    return {
      ts,
      bestBuy: mr?.bestBuyPrice ?? null,
      bestSell: mr?.bestSellPrice ?? null,
      marketMid: marketMidByTs.get(ts) ?? null,
      totalFiat: mr?.totalAvailableFiat ?? null,
      buyAds: mr?.buyAds ?? null,
      sellAds: mr?.sellAds ?? null,
    };
  });

  const trust = trustScoreFor({
    completionRate: latest.completionRate ?? 0,
    orders30d: latest.ordersMonth ?? 0,
    avgReleaseSec: latest.avgReleaseSec,
  });

  const headerData: MerchantHeaderData = {
    id: latest.merchantId,
    name: latest.merchantName,
    isMerchant: Boolean(latest.isMerchant),
    isActive: activeNow,
    ordersMonth: latest.ordersMonth,
    completionRate: latest.completionRate,
    avgReleaseSec: latest.avgReleaseSec,
    bestBuyPrice: activeNow ? latest.bestBuyPrice : null,
    bestSellPrice: activeNow ? latest.bestSellPrice : null,
    totalAvailableFiat: activeNow ? latest.totalAvailableFiat : null,
    buyAds: activeNow ? latest.buyAds : null,
    sellAds: activeNow ? latest.sellAds : null,
    lastSeenTs: latest.ts,
    marketMid: latestMarket?.mid ?? null,
    asset,
    fiat,
    symbol,
    trustScore: trust,
  };

  const hasHistory = merchantTicks.length > 0;

  return (
    <>
      <Topbar title={latest.merchantName} subtitle={subtitle}>
        <LiveDot label="Live" className="hidden sm:inline-flex" />
      </Topbar>

      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <SectionHeader
          kicker="Merchant detail"
          title={latest.merchantName}
          description={`Per-tick snapshots of this counterparty on ${asset}/${fiat}. Prices, spread, premium vs market, depth, live ad count, uptime and hour-of-day presence — all derived from the ingest worker.`}
          right={<RangeTabs value={range} />}
        />

        <Reveal>
          <MerchantHeaderCard m={headerData} />
        </Reveal>

        {!hasHistory ? (
          <Empty
            icon={Clock}
            title="No history yet"
            description={`We've seen this merchant once (${formatSLT(latest.ts)} SLT) but don't have multi-tick history in the ${range} window. Come back after a few more ingest ticks.`}
          />
        ) : (
          <>
            <Reveal delay={60}>
              <MerchantPriceChart points={points} symbol={symbol} />
            </Reveal>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Reveal delay={90}>
                <MerchantSpreadChart points={points} symbol={symbol} />
              </Reveal>
              <Reveal delay={110}>
                <MerchantPremiumChart points={points} />
              </Reveal>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Reveal delay={130}>
                <MerchantDepthChart points={points} symbol={symbol} />
              </Reveal>
              <Reveal delay={150}>
                <MerchantAdCountChart points={points} />
              </Reveal>
            </div>

            <Reveal delay={170}>
              <UptimeStrip
                marketTicks={marketTicks}
                merchantTicks={merchantTicks}
              />
            </Reveal>

            <Reveal delay={190}>
              <HourHeatmap merchantTicks={merchantTicks} />
            </Reveal>
          </>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-muted-foreground">
          <span>
            {history.length} merchant snapshots · {marketMids.length} market
            ticks in {range}
          </span>
          <Link
            href="/merchants"
            className="inline-flex items-center gap-1.5 text-primary hover:underline"
          >
            ← All merchants
          </Link>
        </div>
      </div>
    </>
  );
}
