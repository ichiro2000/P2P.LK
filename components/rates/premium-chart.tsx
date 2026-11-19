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
  ValueTooltip,
  axisX,
  axisY,
  spanOf,
  timeTick,
  type ChartConfig,
} from "@/components/charts/kit";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { dayToMs, formatDay, formatMsDay } from "./model";

import type { PremiumPoint } from "@/lib/fx/overview";

export type PremiumRow = PremiumPoint;

type Ref = "cbsl" | "bank";
/** sell = you sell USDT (P2P bid); buy = you buy USDT (P2P ask). */
type Side = "sell" | "buy";

const config = {
  binance: { label: "Binance", color: C.fg },
  bybit: { label: "Bybit", color: C.c3 },
} satisfies ChartConfig;

const pct = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`;

/**
 * Daily P2P premium for the side you actually trade, like for like:
 *  - Selling USDT: best Buy-ad price (bid) vs CBSL, or vs the highest bank TT
 *    *buying* rate (what a bank pays you for a dollar).
 *  - Buying USDT: cheapest Sell-ad price (ask) vs CBSL, or vs the lowest bank
 *    TT *selling* rate (what a bank charges you for a dollar).
 * 1 USDT is treated as 1 USD.
 */
export function PremiumChart({ rows, firstP2PDay }: { rows: PremiumRow[]; firstP2PDay: string | null }) {
  const [ref, setRef] = useState<Ref>("cbsl");
  const [side, setSide] = useState<Side>("sell");

  const data = useMemo(
    () =>
      rows
        .map((r) => {
          const base = ref === "cbsl" ? r.cbsl : side === "sell" ? r.ttBuy : r.ttSell;
          const prem = (v: number | null) => (v != null && base ? v / base - 1 : null);
          return {
            t: dayToMs(r.day),
            binance: prem(side === "sell" ? r.binanceBid : r.binanceAsk),
            bybit: prem(side === "sell" ? r.bybitBid : r.bybitAsk),
          };
        })
        .filter((d) => d.binance != null || d.bybit != null),
    [rows, ref, side],
  );
  const tick = timeTick(spanOf(data, (d) => d.t));

  return (
    <ChartCard
      title="P2P premium over time"
      description={
        side === "sell"
          ? ref === "cbsl"
            ? "Selling USDT: daily average best Buy-ad price ÷ CBSL indicative − 1."
            : "Selling USDT: daily average best Buy-ad price ÷ highest bank TT buying rate − 1 (what a bank would pay for the dollar)."
          : ref === "cbsl"
            ? "Buying USDT: daily average cheapest Sell-ad price ÷ CBSL indicative − 1."
            : "Buying USDT: daily average cheapest Sell-ad price ÷ lowest bank TT selling rate − 1 (what a bank would charge for the dollar)."
      }
      legend={[
        { label: "Binance", color: C.fg },
        { label: "Bybit", color: C.c3, dashed: true },
      ]}
      actions={
        <>
        <ToggleGroup
          value={[side]}
          onValueChange={(v) => v[0] && setSide(v[0] as Side)}
          variant="outline"
          size="sm"
          spacing={0}
          aria-label="Your side"
        >
          <ToggleGroupItem value="sell" className="px-2.5 text-xs">
            I sell USDT
          </ToggleGroupItem>
          <ToggleGroupItem value="buy" className="px-2.5 text-xs">
            I buy USDT
          </ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup
          value={[ref]}
          onValueChange={(v) => v[0] && setRef(v[0] as Ref)}
          variant="outline"
          size="sm"
          spacing={0}
          aria-label="Reference rate"
        >
          <ToggleGroupItem value="cbsl" className="px-2.5 text-xs">
            vs CBSL
          </ToggleGroupItem>
          <ToggleGroupItem value="bank" className="px-2.5 text-xs">
            vs best bank TT
          </ToggleGroupItem>
        </ToggleGroup>
        </>
      }
      footer={
        firstP2PDay
          ? `P2P history from ${formatDay(firstP2PDay)} (our own Binance/Bybit collector). Weekend reference rates carry the last business day.`
          : undefined
      }
    >
      {data.length < 2 ? (
        <ChartEmpty
          title="Premium history is just starting"
          hint="We need at least two days with both P2P prices and a reference rate. The live premium above updates every minute."
        />
      ) : (
        <ChartFrame config={config} height="md" label="P2P premium over time">
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
            <YAxis {...axisY} tickFormatter={(v) => `${(Number(v) * 100).toFixed(1)}%`} />
            <ReferenceLine y={0} stroke="var(--color-border)" />
            <ValueTooltip indicator="line" labelFormatter={formatMsDay} valueFormatter={(v) => pct(v)} />
            <Line
              type="monotone"
              dataKey="binance"
              name="Binance"
              stroke="var(--color-binance)"
              strokeWidth={1.75}
              dot={data.length < 15}
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
              dot={data.length < 15}
              connectNulls
              {...ANIM}
            />
          </LineChart>
        </ChartFrame>
      )}
    </ChartCard>
  );
}
