"use client";

import { Area, Brush, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";
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
import { formatPrice } from "@/lib/format";
import { HIST_SYNC, type HistRow } from "./types";

export type PriceSeries = "bid" | "ask" | "mid" | "maA" | "maB";

/** Pads a [min, max] domain so lines never touch the frame. */
export function padDomain([min, max]: readonly [number, number]): [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  const pad = Math.max((max - min) * 0.12, Math.abs(max) * 0.0004, 0.01);
  return [min - pad, max + pad];
}

/**
 * Price history: Buy-ads / Sell-ads areas, mid, two time-based moving
 * averages (labels passed in, e.g. "1h avg" / "4h avg"), and a range brush.
 * Missing buckets are null and drawn as gaps, never bridged. In overlay mode it shows this exchange's mid (solid) against the
 * other exchange's mid (dashed) instead.
 *
 * Colour convention (retail view, same as the markets page): Buy ads — the
 * advertiser is buying — use the sell tint; Sell ads use the buy tint.
 */
export function PriceChart({
  data,
  hidden,
  overlay,
  exLabel,
  otherLabel,
  brush,
  onBrush,
  label,
  maLabels,
}: {
  maLabels: readonly [string, string];
  data: HistRow[];
  hidden: ReadonlySet<PriceSeries>;
  overlay: boolean;
  exLabel: string;
  otherLabel: string;
  brush: { start: number; end: number };
  onBrush: (b: { start: number; end: number }) => void;
  label: string;
}) {
  if (data.length < 2) return <ChartEmpty className="h-64 sm:h-80 lg:h-96" />;

  const config = {
    bid: { label: "Buy ads", color: C.sell },
    ask: { label: "Sell ads", color: C.buy },
    mid: { label: overlay ? `${exLabel} mid` : "Mid", color: C.fg },
    maA: { label: maLabels[0], color: C.c3 },
    maB: { label: maLabels[1], color: C.c4 },
    cmp: { label: `${otherLabel} mid`, color: C.c3 },
  } satisfies ChartConfig;

  const tick = timeTick(data[data.length - 1].t - data[0].t);
  const show = (k: PriceSeries) => !hidden.has(k);

  return (
    <ChartFrame config={config} height="lg" label={label} interactive>
      <ComposedChart data={data} margin={MARGIN} syncId={HIST_SYNC} syncMethod="value">
        <defs>
          <FadeGradient id="hist-bid" color={C.sell} from={0.2} />
          <FadeGradient id="hist-ask" color={C.buy} from={0.2} />
          <FadeGradient id="hist-mid" color={C.fg} from={0.16} />
        </defs>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={tick} {...axisX} />
        <YAxis domain={padDomain} tickFormatter={(v: number) => formatPrice(v, 2)} {...axisY} />
        <TimeTooltip valueFormatter={(v) => formatPrice(v, 2)} />

        {overlay ? (
          <>
            <Area
              dataKey="mid"
              name={`${exLabel} mid`}
              type="monotone"
              stroke={C.fg}
              strokeWidth={1.75}
              fill="url(#hist-mid)"
              dot={false}
              connectNulls={false}
              {...ANIM}
            />
            <Line
              dataKey="cmp"
              name={`${otherLabel} mid`}
              type="monotone"
              stroke={C.c3}
              strokeWidth={1.75}
              strokeDasharray="5 4"
              dot={false}
              connectNulls={false}
              {...ANIM}
            />
          </>
        ) : (
          <>
            {show("bid") && (
              <Area
                dataKey="bid"
                name="Buy ads"
                type="monotone"
                stroke={C.sell}
                strokeWidth={1.5}
                fill="url(#hist-bid)"
                dot={false}
                connectNulls={false}
                {...ANIM}
              />
            )}
            {show("ask") && (
              <Area
                dataKey="ask"
                name="Sell ads"
                type="monotone"
                stroke={C.buy}
                strokeWidth={1.5}
                fill="url(#hist-ask)"
                dot={false}
                connectNulls={false}
                {...ANIM}
              />
            )}
            {show("mid") && (
              <Line
                dataKey="mid"
                name="Mid"
                type="monotone"
                stroke={C.fg}
                strokeWidth={1}
                strokeOpacity={0.5}
                dot={false}
                connectNulls={false}
                {...ANIM}
              />
            )}
            {show("maA") && (
              <Line
                dataKey="maA"
                name={maLabels[0]}
                type="monotone"
                stroke={C.c3}
                strokeWidth={1.25}
                strokeDasharray="4 3"
                dot={false}
                connectNulls={false}
                {...ANIM}
              />
            )}
            {show("maB") && (
              <Line
                dataKey="maB"
                name={maLabels[1]}
                type="monotone"
                stroke={C.c4}
                strokeWidth={1.25}
                strokeDasharray="1 3"
                dot={false}
                connectNulls={false}
                {...ANIM}
              />
            )}
          </>
        )}

        {data.length > 8 && (
          <Brush
            dataKey="t"
            height={26}
            travellerWidth={10}
            stroke="var(--color-border)"
            fill="var(--color-card)"
            tickFormatter={tick}
            startIndex={brush.start}
            endIndex={brush.end}
            onChange={(r) => {
              if (r.startIndex != null && r.endIndex != null)
                onBrush({ start: r.startIndex, end: r.endIndex });
            }}
          />
        )}
      </ComposedChart>
    </ChartFrame>
  );
}
