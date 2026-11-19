"use client";

import { CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";
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
import { formatCompact, formatInt } from "@/lib/format";
import { HIST_SYNC, type HistRow } from "./types";

export type DepthBand = "1" | "05" | "top20";

const KEYS: Record<DepthBand, { bid: keyof HistRow; ask: keyof HistRow }> = {
  "1": { bid: "bidDepth1", ask: "askDepth1" },
  "05": { bid: "bidDepth05", ask: "askDepth05" },
  top20: { bid: "bidDepth", ask: "askDepth" },
};

/**
 * Depth per side over time, NOT stacked: sell ads are escrowed USDT, buy ads
 * are declared budgets, so their sum means nothing. `band` picks near-touch
 * depth (within 1 % / 0.5 % of each side's best) or the legacy top-20 sum.
 */
export function DepthChart({
  data,
  asset,
  label,
  band,
}: {
  data: HistRow[];
  asset: string;
  label: string;
  band: DepthBand;
}) {
  const k = KEYS[band];
  const has = data.some((r) => r[k.ask] != null || r[k.bid] != null);
  if (data.length < 2 || !has) {
    return (
      <ChartEmpty
        className="h-44 sm:h-52"
        hint={band === "top20" ? undefined : "Near-price depth is recorded from the latest update on."}
      />
    );
  }
  const config = {
    [k.bid]: { label: "Buy ads (declared)", color: C.sell },
    [k.ask]: { label: "Sell ads", color: C.buy },
  } satisfies ChartConfig;
  const tick = timeTick(data[data.length - 1].t - data[0].t);

  return (
    <ChartFrame config={config} height="sm" label={label}>
      <ComposedChart data={data} margin={MARGIN} syncId={HIST_SYNC} syncMethod="value">
        <CartesianGrid {...GRID} />
        <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={tick} {...axisX} />
        <YAxis tickFormatter={(v: number) => formatCompact(v)} {...axisY} width={44} />
        <TimeTooltip valueFormatter={(v) => `${formatInt(v)} ${asset}`} />
        <Line
          dataKey={k.bid}
          name="Buy ads (declared)"
          type="monotone"
          stroke={C.sell}
          strokeWidth={1.5}
          dot={false}
          connectNulls={false}
          {...ANIM}
        />
        <Line
          dataKey={k.ask}
          name="Sell ads"
          type="monotone"
          stroke={C.buy}
          strokeWidth={1.5}
          dot={false}
          connectNulls={false}
          {...ANIM}
        />
      </ComposedChart>
    </ChartFrame>
  );
}
