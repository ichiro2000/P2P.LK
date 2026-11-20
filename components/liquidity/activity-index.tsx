import { Info } from "lucide-react";
import { ChartCard, C } from "@/components/charts/kit";
import { KpiCard } from "@/components/common/kpi-card";
import { KpiGrid } from "@/components/common/page";
import { Badge } from "@/components/ui/badge";
import { formatCompact, formatInt, formatPct, formatCount } from "@/lib/format";
import { AsOf } from "@/components/common/as-of";
import { cn } from "@/lib/utils";
import type { ActivityIndex as Activity } from "@/lib/activity";
import { ActivityChart } from "./activity-chart";

/**
 * Activity index: last 24 h vs the 24 h before, market-wide and per
 * merchant. Real trade volume isn't public. The headline is the orders index
 * (rises in merchants' 30-day order counts), which price edits can't move.
 */
export function ActivityIndex({ data, symbol: _symbol, asset }: { data: Activity; symbol: string; asset: string }) {
  const { current, previous, change } = data;
  const vsPrev = previous ? "vs prior 24h" : "no prior 24h yet";
  const spark = data.hourly.slice(-24);

  return (
    <div className="space-y-4">
      <KpiGrid>
        <KpiCard
          label="Orders index, 24h"
          value={current.orders != null ? formatInt(current.orders) : "—"}
          change={change.orders}
          changeLabel={previous ? "per hour, vs prior" : undefined}
          sub={previous ? undefined : "orders counted"}
          spark={spark.map((h) => h.orders)}
          sparkTone="neutral"
          icon={
            <Badge variant="outline" className="h-4 px-1.5 text-[9px] font-medium text-muted-foreground">
              index
            </Badge>
          }
        />
        <KpiCard
          label="Sell ads within 1%"
          value={current.nearAsk != null ? `${formatCompact(current.nearAsk)} ${asset}` : "—"}
          change={change.nearAsk}
          changeLabel={vsPrev}
          sub={
            current.nearBid != null
              ? `buy ads ${formatCompact(current.nearBid)} ${asset} (declared)`
              : "hourly average"
          }
          spark={spark.map((h) => h.nearAsk)}
          sparkTone="neutral"
        />
        <KpiCard
          label="Live ads / hour"
          value={formatCount(current.ads)}
          sub="hourly average"
          change={change.ads}
          changeLabel={vsPrev}
          spark={spark.map((h) => h.ads)}
          sparkTone="neutral"
        />
        <KpiCard
          label="Active advertisers"
          value={formatCount(current.merchants)}
          sub="hourly average"
          change={change.merchants}
          changeLabel={vsPrev}
          spark={spark.map((h) => h.merchants)}
          sparkTone="neutral"
        />
      </KpiGrid>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <ChartCard
          title="Orders index and ads, by hour"
          description={`Last ${data.hourly.length} hours, Sri Lanka time. Orders index = rises in merchants' 30-day order counts.`}
          legend={[
            { label: "Orders index", color: C.fg },
            { label: "Live ads", color: C.c4 },
          ]}
          className="lg:col-span-3"
        >
          <ActivityChart hourly={data.hourly} splitTs={data.generatedAt - 86_400} />
        </ChartCard>

        <ChartCard
          title="Merchant activity"
          description="Top advertisers by orders index, last 24h vs the 24h before."
          className="lg:col-span-2"
          contentClassName="px-0"
        >
          <MerchantActivity data={data} asset={asset} />
        </ChartCard>
      </div>

      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
        <Info className="mt-px size-3.5 shrink-0" aria-hidden />
        <span>
          Exchanges don&apos;t publish P2P trade volume. The orders index adds up each merchant&apos;s rise in
          their 30-day completed-order count between back-to-back 10-minute sweeps. Price edits and ad resizes
          don&apos;t move it, but orders leaving the 30-day window pull it down, so it undercounts. Treat it as a
          trend, not a total. Covers {current.hours}h now{previous ? ` and ${previous.hours}h before` : ""}
          {data.latestSweepTs != null ? (
            <>
              {" "}
              · <AsOf ts={data.latestSweepTs} stale={data.latestSweepStale} prefix="sweep" />
            </>
          ) : null}
          .
        </span>
      </p>
    </div>
  );
}

function Change({ v }: { v: number | null }) {
  if (v == null || !Number.isFinite(v)) return null;
  return (
    <span
      className={cn(
        "font-mono tabular-nums",
        v > 0.005 && "text-[color:var(--color-buy)]",
        v < -0.005 && "text-[color:var(--color-sell)]",
        Math.abs(v) <= 0.005 && "text-muted-foreground",
      )}
    >
      {formatPct(v, { frac: 0, sign: true })}
    </span>
  );
}

function MerchantActivity({ data, asset }: { data: Activity; asset: string }) {
  const rows = data.merchants.slice(0, 10);
  if (rows.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-xs text-muted-foreground">
        No merchant sweeps recorded in the last 48 hours yet.
      </p>
    );
  }
  const listed = (m: Activity["merchants"][number]) =>
    m.askAvailable == null && m.bidAvailable == null
      ? "—"
      : `${formatCompact(m.askAvailable ?? 0)} / ${formatCompact(m.bidAvailable ?? 0)}`;
  return (
    <>
      {/* md+: table */}
      <table className="hidden w-full text-xs md:table">
        <thead>
          <tr className="border-b text-[11px] text-muted-foreground">
            <th scope="col" className="px-4 py-1.5 text-left font-normal">Merchant</th>
            <th scope="col" className="px-2 py-1.5 text-right font-normal">Orders</th>
            <th scope="col" className="px-2 py-1.5 text-right font-normal">Ads</th>
            <th scope="col" className="px-4 py-1.5 text-right font-normal">
              <abbr title={`${asset} listed now: sell ads (escrowed) / buy ads (declared)`} className="no-underline">
                Sell / buy {asset}
              </abbr>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((m) => (
            <tr key={m.merchantId}>
              <td className="max-w-40 truncate px-4 py-2 font-medium">{m.name}</td>
              <td className="px-2 py-2 text-right">
                <div className="font-mono tabular-nums">{formatInt(m.ordersNow)}</div>
                <div className="text-[10px]"><Change v={m.ordersChange} /></div>
              </td>
              <td className="px-2 py-2 text-right">
                <div className="font-mono tabular-nums">{formatCount(m.adsNow)}</div>
                <div className="text-[10px]"><Change v={m.adsChange} /></div>
              </td>
              <td className="px-4 py-2 text-right font-mono tabular-nums text-muted-foreground">{listed(m)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* phones: stacked cards */}
      <ul className="divide-y md:hidden">
        {rows.map((m) => (
          <li key={m.merchantId} className="space-y-1 px-4 py-2.5 text-xs">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate font-medium">{m.name}</span>
              <span className="shrink-0 font-mono tabular-nums">
                {formatInt(m.ordersNow)} orders <Change v={m.ordersChange} />
              </span>
            </div>
            <div className="flex justify-between gap-3 text-[11px] text-muted-foreground">
              <span>
                {formatCount(m.adsNow)} ads <Change v={m.adsChange} />
              </span>
              <span className="font-mono tabular-nums">
                sell / buy {listed(m)} {asset}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
