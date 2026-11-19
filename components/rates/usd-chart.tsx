"use client";

import { useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";
import {
  ANIM,
  C,
  ChartCard,
  ChartEmpty,
  ChartFrame,
  FadeGradient,
  GRID,
  MARGIN,
  ValueTooltip,
  axisX,
  axisY,
  spanOf,
  timeTick,
  type ChartConfig,
} from "@/components/charts/kit";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { dayToMs, formatDay, formatMsDay, formatRate } from "./model";

export type UsdHistoryRow = { day: string; indicative: number | null; ttBuy: number | null; ttSell: number | null };

const RANGES = { "1W": 7, "1M": 31, "3M": 92, "1Y": 366, All: null } as const;
type Range = keyof typeof RANGES;

const config = {
  indicative: { label: "CBSL indicative", color: C.fg },
  ttBuy: { label: "Avg TT buying", color: C.buy },
  ttSell: { label: "Avg TT selling", color: C.sell },
} satisfies ChartConfig;

/** CBSL USD/LKR history: indicative (area) with the banks' average TT
 *  buying/selling band as dashed lines. One point per published day. */
export function UsdChart({ history }: { history: UsdHistoryRow[] }) {
  const [range, setRange] = useState<Range>("3M");

  const data = useMemo(() => {
    const days = RANGES[range];
    const last = history[history.length - 1]?.day;
    const cutoff = days && last ? dayToMs(last) - days * 86_400_000 : -Infinity;
    return history.map((r) => ({ t: dayToMs(r.day), ...r })).filter((r) => r.t >= cutoff);
  }, [history, range]);

  const tick = timeTick(spanOf(data, (d) => d.t));
  const first = data[0];
  const last = data[data.length - 1];
  const change = first?.indicative != null && last?.indicative != null ? last.indicative - first.indicative : null;

  return (
    <ChartCard
      title="USD/LKR"
      description={
        change != null && first && last
          ? `${formatDay(first.day, true)} – ${formatDay(last.day, true)}: ${change >= 0 ? "+" : ""}${change.toFixed(2)} LKR (${((change / first.indicative!) * 100).toFixed(2)}%)`
          : "Central Bank of Sri Lanka, LKR per 1 USD"
      }
      legend={[
        { label: "CBSL indicative", color: C.fg },
        { label: "Avg TT buying", color: C.buy, dashed: true },
        { label: "Avg TT selling", color: C.sell, dashed: true },
      ]}
      actions={
        <ToggleGroup
          value={[range]}
          onValueChange={(v) => v[0] && setRange(v[0] as Range)}
          variant="outline"
          size="sm"
          spacing={0}
          aria-label="Chart range"
        >
          {(Object.keys(RANGES) as Range[]).map((r) => (
            <ToggleGroupItem key={r} value={r} className="px-2.5 font-mono text-xs">
              {r}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      }
      footer={
        history.length > 0
          ? `Source: Central Bank of Sri Lanka. History from ${formatDay(history[0].day)}. Business days only.`
          : undefined
      }
    >
      {data.length < 2 ? (
        <ChartEmpty
          title="Not enough history yet"
          hint="CBSL publishes one rate per business day. The chart fills in as days are collected."
        />
      ) : (
        <ChartFrame config={config} height="lg" label={`USD/LKR over ${range}`}>
          <ComposedChart data={data} margin={MARGIN}>
            <defs>
              <FadeGradient id="usd-ind" color="var(--color-indicative)" from={0.18} />
            </defs>
            <CartesianGrid {...GRID} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(v) => tick(Number(v))}
              {...axisX}
            />
            <YAxis {...axisY} domain={["auto", "auto"]} tickFormatter={(v) => Number(v).toFixed(0)} />
            <ValueTooltip
              indicator="line"
              labelFormatter={formatMsDay}
              valueFormatter={(v) => formatRate(v)}
            />
            <Area
              type="monotone"
              dataKey="indicative"
              name="CBSL indicative"
              stroke="var(--color-indicative)"
              strokeWidth={1.75}
              fill="url(#usd-ind)"
              dot={false}
              connectNulls
              {...ANIM}
            />
            <Line
              type="monotone"
              dataKey="ttBuy"
              name="Avg TT buying"
              stroke="var(--color-ttBuy)"
              strokeWidth={1.25}
              strokeDasharray="4 3"
              dot={false}
              connectNulls
              {...ANIM}
            />
            <Line
              type="monotone"
              dataKey="ttSell"
              name="Avg TT selling"
              stroke="var(--color-ttSell)"
              strokeWidth={1.25}
              strokeDasharray="4 3"
              dot={false}
              connectNulls
              {...ANIM}
            />
          </ComposedChart>
        </ChartFrame>
      )}
    </ChartCard>
  );
}
