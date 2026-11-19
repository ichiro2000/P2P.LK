"use client";

import { useId } from "react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
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
import { formatPct, formatPrice } from "@/lib/format";

export type RecapPoint = {
  /** epoch ms */
  t: number;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  spreadPct: number | null;
};

const priceConfig = {
  bid: { label: "Buy ads", color: C.sell },
  ask: { label: "Sell ads", color: C.buy },
  mid: { label: "Mid", color: C.fg },
} satisfies ChartConfig;

const spreadConfig = {
  spreadPct: { label: "Spread", color: C.fg },
} satisfies ChartConfig;

/** Price + spread over the recap window, side by side on wide screens. */
export function RecapCharts({ points, rangeLabel }: { points: RecapPoint[]; rangeLabel: string }) {
  const gid = `recap-spread-${useId().replace(/:/g, "")}`;
  const tick = timeTick(spanOf(points, (p) => p.t));
  const enough = points.filter((p) => p.mid != null).length >= 2;

  return (
    <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
      <ChartCard
        title="Price"
        description={`Best buy-ad and sell-ad prices, ${rangeLabel}`}
        legend={[
          { label: "Buy ads", color: C.sell },
          { label: "Sell ads", color: C.buy },
          { label: "Mid", color: C.fg, dashed: true },
        ]}
      >
        {!enough ? (
          <ChartEmpty />
        ) : (
          <ChartFrame config={priceConfig} height="sm" label={`Best buy-ad, sell-ad and mid price, ${rangeLabel}`}>
            <LineChart data={points} margin={MARGIN}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} {...axisX} tickFormatter={tick} />
              <YAxis {...axisY} domain={["auto", "auto"]} tickFormatter={(v: number) => formatPrice(v, 2)} />
              <TimeTooltip valueFormatter={(v) => formatPrice(v, 2)} />
              <Line dataKey="bid" type="monotone" stroke="var(--color-bid)" strokeWidth={1.5} dot={false} connectNulls {...ANIM} />
              <Line dataKey="ask" type="monotone" stroke="var(--color-ask)" strokeWidth={1.5} dot={false} connectNulls {...ANIM} />
              <Line
                dataKey="mid"
                type="monotone"
                stroke="var(--color-mid)"
                strokeWidth={1.25}
                strokeDasharray="4 3"
                dot={false}
                connectNulls
                {...ANIM}
              />
            </LineChart>
          </ChartFrame>
        )}
      </ChartCard>

      <ChartCard title="Spread" description={`Gap between best buy and sell ads, ${rangeLabel}`}>
        {!enough ? (
          <ChartEmpty />
        ) : (
          <ChartFrame config={spreadConfig} height="sm" label={`Spread percentage, ${rangeLabel}`}>
            <AreaChart data={points} margin={MARGIN}>
              <defs>
                <FadeGradient id={gid} color="var(--color-spreadPct)" from={0.18} />
              </defs>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} {...axisX} tickFormatter={tick} />
              <YAxis {...axisY} width={52} tickFormatter={(v: number) => formatPct(v, { frac: 2 })} />
              <TimeTooltip valueFormatter={(v) => formatPct(v, { frac: 2 })} />
              <Area
                dataKey="spreadPct"
                type="monotone"
                stroke="var(--color-spreadPct)"
                strokeWidth={1.5}
                fill={`url(#${gid})`}
                dot={false}
                connectNulls
                {...ANIM}
              />
            </AreaChart>
          </ChartFrame>
        )}
      </ChartCard>
    </div>
  );
}
