"use client";

import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from "recharts";
import {
  ANIM,
  C,
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
import { formatInt } from "@/lib/format";

/** Orders index (bars) and live ads (line) per Sri Lanka hour, last 48 h. */
export function ActivityChart({
  hourly,
  splitTs,
}: {
  hourly: { ts: number; ads: number; orders: number }[];
  /** Start of the current 24 h window (unix s) — drawn as a divider. */
  splitTs: number;
}) {
  if (hourly.length < 2) {
    return (
      <ChartEmpty
        className="h-44 sm:h-52"
        hint="Needs a couple of hours of merchant sweeps (every 10 min)."
      />
    );
  }
  // One row per hour on a full grid, so a missing hour is a gap.
  const byTs = new Map(hourly.map((h) => [h.ts, h]));
  const data: { t: number; orders: number | null; ads: number | null }[] = [];
  for (let ts = hourly[0].ts; ts <= hourly[hourly.length - 1].ts; ts += 3600) {
    const h = byTs.get(ts);
    data.push({ t: ts * 1000, orders: h ? h.orders : null, ads: h ? h.ads : null });
  }
  const config = {
    orders: { label: "Orders index", color: C.fg },
    ads: { label: "Live ads", color: C.c4 },
  } satisfies ChartConfig;
  const first = data[0].t;
  const split = splitTs * 1000;
  const total = hourly.reduce((s, h) => s + h.orders, 0);

  return (
    <ChartFrame
      config={config}
      height="sm"
      label={`Orders index per hour over the last ${hourly.length} hours, ${formatInt(total)} in total; live ads from ${formatInt(hourly[0].ads)} to ${formatInt(hourly[hourly.length - 1].ads)}.`}
    >
      <ComposedChart data={data} margin={{ ...MARGIN, right: 0 }}>
        <CartesianGrid {...GRID} />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
          tickFormatter={timeTick(data[data.length - 1].t - first)}
          {...axisX}
        />
        <YAxis yAxisId="orders" tickFormatter={(v: number) => formatInt(v)} {...axisY} width={36} allowDecimals={false} />
        <YAxis yAxisId="ads" orientation="right" tickFormatter={(v: number) => formatInt(v)} {...axisY} width={32} allowDecimals={false} />
        <TimeTooltip valueFormatter={(v, k) => (k === "orders" ? `${formatInt(v)} orders` : `${formatInt(v)} ads`)} />
        {split > first && (
          <ReferenceLine
            yAxisId="orders"
            x={split}
            stroke="var(--color-muted-foreground)"
            strokeDasharray="3 3"
            label={{
              value: "last 24h",
              position: "insideTopRight",
              fill: "var(--color-muted-foreground)",
              fontSize: 10,
            }}
          />
        )}
        <Bar
          yAxisId="orders"
          dataKey="orders"
          name="Orders index"
          fill={C.fg}
          fillOpacity={0.7}
          radius={[2, 2, 0, 0]}
          maxBarSize={8}
          {...ANIM}
        />
        <Line
          yAxisId="ads"
          dataKey="ads"
          name="Live ads"
          type="monotone"
          stroke={C.c4}
          strokeWidth={1.5}
          dot={false}
          connectNulls={false}
          {...ANIM}
        />
      </ComposedChart>
    </ChartFrame>
  );
}
