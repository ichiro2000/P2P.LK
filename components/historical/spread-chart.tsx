"use client";

import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from "recharts";
import {
  ANIM,
  C,
  ChartEmpty,
  ChartFrame,
  FadeGradient,
  GRID,
  MARGIN,
  TimeTooltip,
  axisX,
  axisY,
  timeTick,
  type ChartConfig,
} from "@/components/charts/kit";
import { HIST_SYNC, type HistRow } from "./types";

/** Spread (Sell ads − Buy ads, % of mid) over time, optional other exchange.
 *  The axis goes below zero when the book is crossed (best bid above best
 *  ask), with a zero line for reference (F29). Gaps stay gaps. */
export function SpreadChart({
  data,
  overlay,
  exLabel,
  otherLabel,
  label,
}: {
  data: HistRow[];
  overlay: boolean;
  exLabel: string;
  otherLabel: string;
  label: string;
}) {
  if (data.length < 2) return <ChartEmpty className="h-44 sm:h-52" />;
  const config = {
    spread: { label: `${exLabel} spread`, color: C.fg },
    cmpSpread: { label: `${otherLabel} spread`, color: C.c3 },
  } satisfies ChartConfig;
  const tick = timeTick(data[data.length - 1].t - data[0].t);
  const fmt = (v: number) => `${v.toFixed(Math.abs(v) < 1 ? 2 : 1)}%`;
  const crossed = data.some((r) => (r.spread ?? 0) < 0 || (overlay && (r.cmpSpread ?? 0) < 0));

  return (
    <ChartFrame config={config} height="sm" label={label}>
      <ComposedChart data={data} margin={MARGIN} syncId={HIST_SYNC} syncMethod="value">
        <defs>
          <FadeGradient id="hist-spread" color={C.fg} from={0.22} />
        </defs>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={tick} {...axisX} />
        <YAxis tickFormatter={fmt} domain={crossed ? ["auto", "auto"] : [0, "auto"]} {...axisY} width={44} />
        {crossed && <ReferenceLine y={0} stroke="var(--color-muted-foreground)" strokeDasharray="3 3" />}
        <TimeTooltip valueFormatter={(v) => `${v.toFixed(3)}%`} />
        <Area
          dataKey="spread"
          name={`${exLabel} spread`}
          type="monotone"
          stroke={C.fg}
          strokeWidth={1.5}
          fill="url(#hist-spread)"
          dot={false}
          connectNulls={false}
          {...ANIM}
        />
        {overlay && (
          <Line
            dataKey="cmpSpread"
            name={`${otherLabel} spread`}
            type="monotone"
            stroke={C.c3}
            strokeWidth={1.5}
            strokeDasharray="5 4"
            dot={false}
            connectNulls={false}
            {...ANIM}
          />
        )}
      </ComposedChart>
    </ChartFrame>
  );
}
