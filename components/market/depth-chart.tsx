"use client";

import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";
import type { MarketSnapshot } from "@/lib/types";
import { depthCurve } from "@/lib/market-insights";
import { formatCompact, formatFiat } from "@/lib/format";
import { FIAT } from "@/lib/constants";
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
  type ChartConfig,
} from "@/components/charts/kit";

// Buy ads (bids, where you sell) are red; sell ads (asks, where you buy)
// are green — the convention used across the app.
const config = {
  bid: { label: "Buy ads (bids)", color: C.sell },
  ask: { label: "Sell ads (asks)", color: C.buy },
} satisfies ChartConfig;

export function DepthChart({ market, className }: { market: MarketSnapshot; className?: string }) {
  const curve = useMemo(() => depthCurve(market.ads), [market.ads]);
  const sym = FIAT.symbol;

  return (
    <ChartCard
      className={className}
      title="Order-book depth"
      description={
        curve.mid != null
          ? `Cumulative USDT on each side of mid ${formatFiat(curve.mid, sym, 2)}`
          : "Cumulative USDT on each side of mid"
      }
      legend={[
        { label: `Bids ${formatCompact(curve.bidTotal)}`, color: C.sell },
        { label: `Asks ${formatCompact(curve.askTotal)}`, color: C.buy },
        { label: "Mid", color: C.muted, dashed: true },
      ]}
    >
      {curve.points.length < 3 || !curve.domain ? (
        <ChartEmpty title="No ads on the book" hint="Try another payment method or publisher filter." />
      ) : (
        <ChartFrame
          config={config}
          height="md"
          label={`Depth chart. ${formatCompact(curve.bidTotal)} USDT of bids and ${formatCompact(curve.askTotal)} USDT of asks.`}
        >
          <AreaChart data={curve.points} margin={MARGIN}>
            <defs>
              <FadeGradient id="depth-bid" color={C.sell} from={0.35} />
              <FadeGradient id="depth-ask" color={C.buy} from={0.35} />
            </defs>
            <CartesianGrid {...GRID} />
            <XAxis
              {...axisX}
              dataKey="price"
              type="number"
              domain={curve.domain}
              allowDataOverflow
              tickCount={5}
              tickFormatter={(v: number) => v.toFixed(1)}
            />
            <YAxis {...axisY} width={44} tickFormatter={(v: number) => formatCompact(v)} />
            <ValueTooltip
              indicator="line"
              labelFormatter={(l) => formatFiat(Number(l), sym, 2)}
              valueFormatter={(v) => `${formatCompact(v)} USDT`}
            />
            <ReferenceLine x={curve.mid ?? undefined} stroke={C.muted} strokeDasharray="4 4" />
            <Area
              dataKey="bid"
              type="stepBefore"
              stroke="var(--color-bid)"
              strokeWidth={1.75}
              fill="url(#depth-bid)"
              {...ANIM}
            />
            <Area
              dataKey="ask"
              type="stepAfter"
              stroke="var(--color-ask)"
              strokeWidth={1.75}
              fill="url(#depth-ask)"
              {...ANIM}
            />
          </AreaChart>
        </ChartFrame>
      )}
    </ChartCard>
  );
}
