"use client";

import { useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
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
  spanOf,
  timeTick,
  type ChartConfig,
} from "@/components/charts/kit";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { FIAT } from "@/lib/constants";
import { formatFiat, formatPct } from "@/lib/format";
import type { SpreadPoint } from "@/lib/compare";

const config = {
  binance: { label: "Binance", color: C.fg },
  bybit: { label: "Bybit", color: C.c3 },
} satisfies ChartConfig;

type Unit = "pct" | "abs";

/** Spread over time, Binance (solid) vs Bybit (dashed). */
export function SpreadOverlay({
  points,
  range,
  actions,
}: {
  points: SpreadPoint[];
  range: string;
  actions?: React.ReactNode;
}) {
  const [unit, setUnit] = useState<Unit>("pct");
  const data =
    unit === "pct"
      ? points.map((p) => ({ t: p.t, binance: p.binance, bybit: p.bybit }))
      : points.map((p) => ({ t: p.t, binance: p.binanceAbs, bybit: p.bybitAbs }));
  const fmt = (v: number) => (unit === "pct" ? formatPct(v, { frac: 2 }) : formatFiat(v, FIAT.symbol, 2));
  const tick = timeTick(spanOf(data, (d) => d.t));

  const avg = (k: "binance" | "bybit") => {
    const xs = data.map((d) => d[k]).filter((v): v is number => v != null);
    return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null;
  };
  const bnAvg = avg("binance");
  const byAvg = avg("bybit");

  return (
    <ChartCard
      title="Spread over time"
      description={
        bnAvg != null || byAvg != null
          ? `${range} average: Binance ${bnAvg != null ? fmt(bnAvg) : "—"} · Bybit ${byAvg != null ? fmt(byAvg) : "—"}. Lower is a tighter market.`
          : "Best sell ad minus best buy ad, per exchange."
      }
      legend={[
        { label: "Binance", color: C.fg },
        { label: "Bybit", color: C.c3, dashed: true },
      ]}
      actions={
        <>
          <ToggleGroup
            value={[unit]}
            onValueChange={(v) => v[0] && setUnit(v[0] as Unit)}
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="Spread unit"
          >
            <ToggleGroupItem value="pct" className="px-2.5 text-xs">
              %
            </ToggleGroupItem>
            <ToggleGroupItem value="abs" className="px-2.5 text-xs">
              {FIAT.symbol}
            </ToggleGroupItem>
          </ToggleGroup>
          {actions}
        </>
      }
    >
      {data.length < 2 ? (
        <ChartEmpty />
      ) : (
        <ChartFrame
          config={config}
          height="md"
          label={`Spread over ${range} for Binance and Bybit`}
        >
          <LineChart data={data} margin={MARGIN}>
            <CartesianGrid {...GRID} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(v) => tick(Number(v))}
              {...axisX}
            />
            <YAxis
              {...axisY}
              tickFormatter={(v) =>
                unit === "pct" ? formatPct(Number(v), { frac: 2 }) : Number(v).toFixed(2)
              }
            />
            <TimeTooltip valueFormatter={(v) => fmt(v)} />
            <Line
              type="monotone"
              dataKey="binance"
              name="Binance"
              stroke="var(--color-binance)"
              strokeWidth={1.75}
              dot={false}
              connectNulls
              {...ANIM}
            />
            <Line
              type="monotone"
              dataKey="bybit"
              name="Bybit"
              stroke="var(--color-bybit)"
              strokeWidth={1.75}
              strokeDasharray="5 4"
              dot={false}
              connectNulls
              {...ANIM}
            />
          </LineChart>
        </ChartFrame>
      )}
    </ChartCard>
  );
}
