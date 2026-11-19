"use client";

import { CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";
import {
  ANIM,
  C,
  ChartCard,
  ChartEmpty,
  ChartFrame,
  GRID,
  MARGIN,
  TimeTooltip,
  axisX,
  axisY,
  timeTick,
  type ChartConfig,
} from "@/components/charts/kit";
import { formatCompact, formatInt } from "@/lib/format";

export type DepthPoint = {
  ts: number;
  /** Near-touch depth (USDT within 1 % / 0.5 % of each side's best). */
  bidDepth1: number | null;
  askDepth1: number | null;
  bidDepth05: number | null;
  askDepth05: number | null;
  /** Legacy top-20 sums, shown only when no near-touch data exists yet. */
  bidDepth: number | null;
  askDepth: number | null;
};

/**
 * Near-touch depth per side over time. The sides are NOT added together:
 * sell ads are escrowed USDT, buy ads are declared budgets. Missing buckets
 * stay gaps. Falls back to the old top-20 sums (labelled) for windows
 * recorded before near-touch depth existed.
 */
export function DepthTrend({ points, asset }: { points: DepthPoint[]; asset: string }) {
  const near = points.some((p) => p.askDepth1 != null || p.bidDepth1 != null);
  const data = points.map((p) => ({
    t: p.ts * 1000,
    ask: near ? p.askDepth1 : p.askDepth,
    bid: near ? p.bidDepth1 : p.bidDepth,
    ask05: near ? p.askDepth05 : null,
    bid05: near ? p.bidDepth05 : null,
  }));
  const asks = data.map((d) => d.ask).filter((v): v is number => v != null);
  const config = {
    ask: { label: near ? "Sell ads ±1%" : "Sell ads, top 20", color: C.buy },
    bid: { label: near ? "Buy ads ±1% (declared)" : "Buy ads, top 20", color: C.sell },
    ask05: { label: "Sell ads ±0.5%", color: C.buy },
    bid05: { label: "Buy ads ±0.5%", color: C.sell },
  } satisfies ChartConfig;

  return (
    <ChartCard
      title="Depth near the price"
      description={
        near
          ? `${asset} within 1% (solid) and 0.5% (dashed) of each side's best price. Buy ads are declared budgets, not escrowed.`
          : `${asset} in the top 20 ads per side. Near-price depth is recorded from now on and will replace this.`
      }
      legend={[
        { label: near ? "Sell ads (you buy)" : "Sell ads, top 20", color: C.buy },
        { label: near ? "Buy ads (you sell, declared)" : "Buy ads, top 20", color: C.sell },
        ...(near ? [{ label: "within 0.5%", color: C.fg, dashed: true }] : []),
      ]}
    >
      {asks.length < 2 ? (
        <ChartEmpty className="h-56 sm:h-72" />
      ) : (
        <ChartFrame
          config={config}
          height="md"
          label={`Sell-ad depth ${near ? "within 1% of the best price" : "in the top 20"} from ${formatInt(asks[0])} to ${formatInt(asks[asks.length - 1])} ${asset}, low ${formatInt(Math.min(...asks))}, high ${formatInt(Math.max(...asks))}.`}
        >
          <ComposedChart data={data} margin={MARGIN}>
            <CartesianGrid {...GRID} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={timeTick(data[data.length - 1].t - data[0].t)}
              {...axisX}
            />
            <YAxis tickFormatter={(v: number) => formatCompact(v)} {...axisY} width={44} />
            <TimeTooltip valueFormatter={(v) => `${formatInt(v)} ${asset}`} />
            <Line dataKey="ask" name={config.ask.label} type="monotone" stroke={C.buy} strokeWidth={1.75} dot={false} connectNulls={false} {...ANIM} />
            <Line dataKey="bid" name={config.bid.label} type="monotone" stroke={C.sell} strokeWidth={1.75} dot={false} connectNulls={false} {...ANIM} />
            {near && (
              <Line dataKey="ask05" name={config.ask05.label} type="monotone" stroke={C.buy} strokeWidth={1} strokeDasharray="4 3" dot={false} connectNulls={false} {...ANIM} />
            )}
            {near && (
              <Line dataKey="bid05" name={config.bid05.label} type="monotone" stroke={C.sell} strokeWidth={1} strokeDasharray="4 3" dot={false} connectNulls={false} {...ANIM} />
            )}
          </ComposedChart>
        </ChartFrame>
      )}
    </ChartCard>
  );
}
