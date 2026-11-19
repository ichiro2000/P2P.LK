"use client";

import { useId } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";
import {
  ANIM,
  C,
  ChartCard,
  ChartEmpty,
  ChartFrame,
  FadeGradient,
  GRID,
  MARGIN,
  TimeTooltip,
  axisX,
  axisY,
  spanOf,
  timeTick,
  type ChartConfig,
} from "@/components/charts/kit";
import { formatCount } from "@/lib/format";

export type OrderTrendPoint = {
  ts: number;
  ordersMonth: number | null;
  completionRate: number | null;
};

const config = {
  orders: { label: "Orders 30d", color: C.sell },
} satisfies ChartConfig;

/**
 * The flagged taker's rolling 30d order count over time. A line that keeps
 * rising after the first report is the clearest "still trading" signal. The
 * dashed vertical line marks the first report.
 */
export function OrderTrendChart({
  points,
  firstReportTs,
}: {
  points: OrderTrendPoint[];
  firstReportTs: number | null;
}) {
  const gid = `susp-orders-${useId().replace(/:/g, "")}`;
  const data = points.map((p) => ({ t: p.ts * 1000, orders: p.ordersMonth ?? null }));
  const hasAny = data.filter((d) => d.orders != null).length >= 2;
  const tick = timeTick(spanOf(data, (d) => d.t));

  return (
    <ChartCard
      title="30-day order count over time"
      description="A line that keeps rising after the first report means the taker is still trading."
      legend={[
        { label: "Orders 30d", color: C.sell },
        ...(firstReportTs != null ? [{ label: "First report", color: C.warn, dashed: true }] : []),
      ]}
    >
      {!hasAny ? (
        <ChartEmpty
          title="Not enough listing history"
          hint="This taker hasn't appeared on the LKR book often enough to draw a trend."
        />
      ) : (
        <ChartFrame config={config} height="sm" label="Rolling 30-day order count for this taker over time">
          <AreaChart data={data} margin={{ ...MARGIN, top: 16 }}>
            <defs>
              <FadeGradient id={gid} color="var(--color-orders)" />
            </defs>
            <CartesianGrid {...GRID} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              {...axisX}
              tickFormatter={tick}
            />
            <YAxis {...axisY} width={40} allowDecimals={false} tickFormatter={(v: number) => formatCount(v)} />
            <TimeTooltip valueFormatter={(v) => formatCount(v)} />
            {firstReportTs != null && (
              <ReferenceLine
                x={firstReportTs * 1000}
                stroke={C.warn}
                strokeDasharray="4 4"
                ifOverflow="extendDomain"
                label={{
                  value: "First report",
                  position: "insideTopLeft",
                  fill: C.warn,
                  fontSize: 11,
                }}
              />
            )}
            <Area
              type="monotone"
              dataKey="orders"
              stroke="var(--color-orders)"
              strokeWidth={1.75}
              fill={`url(#${gid})`}
              connectNulls
              dot={false}
              {...ANIM}
            />
          </AreaChart>
        </ChartFrame>
      )}
    </ChartCard>
  );
}
