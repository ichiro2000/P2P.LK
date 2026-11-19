"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
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
import type { GooglePoint, GoogleRange } from "@/lib/fx/google-view";

const priceConfig = {
  google: { label: "Google USD/LKR", color: C.c3 },
  binance: { label: "Binance USDT", color: C.fg },
  bybit: { label: "Bybit USDT", color: C.c2 },
} satisfies ChartConfig;

const premConfig = {
  binancePremium: { label: "Binance premium", color: C.fg },
  bybitPremium: { label: "Bybit premium", color: C.c2 },
} satisfies ChartConfig;

const RANGES: GoogleRange[] = ["24h", "7d", "30d"];
const pct = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`;
const rs = (v: number) => `Rs ${v.toFixed(2)}`;

/**
 * Two synced charts: USDT P2P mid (both exchanges) against Google's USD/LKR,
 * and the premium between them. The dashed line at the average premium for
 * the shown range is the "normal" gap — above it USDT is dear vs the dollar,
 * below it cheap.
 */
export function GoogleChart({ initial }: { initial: { range: GoogleRange; points: GooglePoint[] } }) {
  const [state, setState] = useState(initial);
  const [loading, setLoading] = useState(false);

  async function pick(range: GoogleRange) {
    if (range === state.range || loading) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/rates/google?range=${range}`);
      if (r.ok) setState(await r.json());
    } finally {
      setLoading(false);
    }
  }

  const pts = state.points;
  const tick = timeTick(spanOf(pts, (p) => p.t));
  const avg = useMemo(() => {
    const v = pts.flatMap((p) => [p.binancePremium, p.bybitPremium]).filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  }, [pts]);
  const hasGoogle = pts.some((p) => p.google != null);
  // With only a few Google readings a line is just a point — draw dots.
  const dot = pts.filter((p) => p.google != null).length < 4 ? { r: 3 } : false;

  const actions = (
    <ToggleGroup
      value={[state.range]}
      onValueChange={(v) => v[0] && pick(v[0] as GoogleRange)}
      variant="outline"
      size="sm"
      aria-label="Range"
    >
      {RANGES.map((r) => (
        <ToggleGroupItem key={r} value={r} className="px-3 font-mono text-xs">
          {r.toUpperCase()}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard
        title="USDT vs Google USD/LKR"
        description="USDT mid price on each exchange against Google's mid-market dollar, same moments."
        legend={[
          { label: "Google USD/LKR", color: C.c3, dashed: true },
          { label: "Binance USDT", color: C.fg },
          { label: "Bybit USDT", color: C.c2 },
        ]}
        actions={actions}
      >
        {pts.length < 2 || !hasGoogle ? (
          <ChartEmpty hint="Google's rate is read every 30 minutes — the comparison fills in as readings arrive." />
        ) : (
          <ChartFrame config={priceConfig} height="md" label={`USDT P2P price vs Google USD/LKR, last ${state.range}`}>
            <LineChart data={pts} margin={MARGIN} syncId="google-usd">
              <CartesianGrid {...GRID} />
              <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} scale="time" tickFormatter={tick} {...axisX} />
              <YAxis domain={["auto", "auto"]} tickFormatter={(v) => Number(v).toFixed(0)} {...axisY} />
              <TimeTooltip valueFormatter={(v) => rs(v)} />
              <Line dataKey="google" type="stepAfter" stroke={C.c3} strokeDasharray="5 4" strokeWidth={1.5} dot={dot} connectNulls {...ANIM} />
              <Line dataKey="binance" type="monotone" stroke={C.fg} strokeWidth={1.75} dot={false} {...ANIM} />
              <Line dataKey="bybit" type="monotone" stroke={C.c2} strokeWidth={1.75} dot={false} {...ANIM} />
            </LineChart>
          </ChartFrame>
        )}
      </ChartCard>

      <ChartCard
        title="USDT premium over Google's dollar"
        description={
          avg != null
            ? `USDT mid ÷ Google USD/LKR − 1. Dashed line: the ${state.range} average (${pct(avg)}).`
            : "USDT mid ÷ Google USD/LKR − 1."
        }
        legend={[
          { label: "Binance", color: C.fg },
          { label: "Bybit", color: C.c2 },
        ]}
      >
        {pts.length < 2 || !hasGoogle ? (
          <ChartEmpty hint="Needs a few Google readings first." />
        ) : (
          <ChartFrame config={premConfig} height="md" label={`USDT premium over Google USD/LKR, last ${state.range}`}>
            <LineChart data={pts} margin={MARGIN} syncId="google-usd">
              <CartesianGrid {...GRID} />
              <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} scale="time" tickFormatter={tick} {...axisX} />
              <YAxis domain={["auto", "auto"]} tickFormatter={(v) => pct(Number(v))} {...axisY} />
              <TimeTooltip valueFormatter={(v) => pct(v)} />
              {avg != null && <ReferenceLine y={avg} stroke={C.muted} strokeDasharray="4 4" />}
              <Line dataKey="binancePremium" name="Binance premium" type="monotone" stroke={C.fg} strokeWidth={1.75} dot={dot} {...ANIM} />
              <Line dataKey="bybitPremium" name="Bybit premium" type="monotone" stroke={C.c2} strokeWidth={1.75} dot={dot} {...ANIM} />
            </LineChart>
          </ChartFrame>
        )}
      </ChartCard>
    </div>
  );
}
