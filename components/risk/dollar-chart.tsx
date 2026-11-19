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
  type LegendItem,
} from "@/components/charts/kit";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ExchangeId } from "@/lib/exchanges/types";
import type { IndexedPoint } from "@/lib/dollar-signals";

const config = {
  google: { label: "Google USD/LKR", color: C.c3 },
  binance: { label: "Binance USDT", color: C.fg },
  bybit: { label: "Bybit USDT", color: C.c2 },
  binancePremium: { label: "Binance premium", color: C.c4 },
  bybitPremium: { label: "Bybit premium", color: C.c5 },
} satisfies ChartConfig;

const RANGES = ["24h", "7d"] as const;
type Range = (typeof RANGES)[number];
const pct = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`;

/**
 * Google USD/LKR and the USDT mid, both indexed to 100 at the start of the
 * window, so the two moves are directly comparable; the premium (USDT ÷
 * Google − 1) is on the right axis.
 */
export function DollarChart({
  chart,
  exchanges,
}: {
  chart: Record<Range, IndexedPoint[]>;
  exchanges: ExchangeId[];
}) {
  const [range, setRange] = useState<Range>("24h");
  const pts = chart[range];
  const tick = timeTick(spanOf(pts, (p) => p.t));
  const googleN = pts.filter((p) => p.google != null).length;
  const hasUsdt = exchanges.some((e) => pts.some((p) => p[e] != null));
  const dot = googleN < 4 ? { r: 3 } : false;

  const legend: LegendItem[] = [
    { label: "Google USD/LKR", color: C.c3, dashed: true },
    ...exchanges.map((e) => ({ label: `${e === "binance" ? "Binance" : "Bybit"} USDT`, color: config[e].color })),
    ...exchanges.map((e) => ({
      label: `${e === "binance" ? "Binance" : "Bybit"} premium (right)`,
      color: config[`${e}Premium`].color,
      dashed: true,
    })),
  ];

  return (
    <ChartCard
      title="Dollar vs USDT, indexed"
      description="Both start at 100, so a 0.3% rise shows as 100.3 on either line. Premium = USDT mid ÷ Google USD/LKR − 1 (right axis)."
      legend={legend}
      actions={
        <ToggleGroup
          value={[range]}
          onValueChange={(v) => v[0] && setRange(v[0] as Range)}
          variant="outline"
          size="sm"
          aria-label="Chart range"
        >
          {RANGES.map((r) => (
            <ToggleGroupItem key={r} value={r} className="px-3 font-mono text-xs">
              {r.toUpperCase()}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      }
    >
      {pts.length < 2 || googleN === 0 || !hasUsdt ? (
        <ChartEmpty hint="Google's rate is read every 30 minutes; the comparison fills in as readings and USDT snapshots arrive." />
      ) : (
        <ChartFrame config={config} height="md" label={`Google USD/LKR and USDT mid indexed to 100, with the premium, last ${range}`}>
          <LineChart data={pts} margin={{ ...MARGIN, right: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} scale="time" tickFormatter={tick} {...axisX} />
            <YAxis yAxisId="idx" domain={["auto", "auto"]} tickFormatter={(v) => Number(v).toFixed(1)} {...axisY} width={44} />
            <YAxis yAxisId="prem" orientation="right" domain={["auto", "auto"]} tickFormatter={(v) => pct(Number(v))} {...axisY} width={52} />
            <TimeTooltip valueFormatter={(v, key) => (key.endsWith("Premium") ? pct(v) : v.toFixed(2))} />
            <Line yAxisId="idx" dataKey="google" type="stepAfter" stroke={C.c3} strokeDasharray="5 4" strokeWidth={1.5} dot={dot} {...ANIM} />
            {exchanges.map((e) => (
              <Line key={e} yAxisId="idx" dataKey={e} type="monotone" stroke={config[e].color} strokeWidth={1.75} dot={false} {...ANIM} />
            ))}
            {exchanges.map((e) => (
              <Line
                key={`${e}-p`}
                yAxisId="prem"
                dataKey={`${e}Premium`}
                type="monotone"
                stroke={config[`${e}Premium`].color}
                strokeDasharray="2 3"
                strokeWidth={1.25}
                dot={false}
                {...ANIM}
              />
            ))}
          </LineChart>
        </ChartFrame>
      )}
    </ChartCard>
  );
}
