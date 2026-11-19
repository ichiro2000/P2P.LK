"use client";

import { Bar, Brush, CartesianGrid, ComposedChart, XAxis, YAxis } from "recharts";
import {
  C,
  ChartEmpty,
  ChartFrame,
  GRID,
  MARGIN,
  axisX,
  axisY,
  fullTime,
  timeTick,
  type ChartConfig,
} from "@/components/charts/kit";
import { ChartTooltip } from "@/components/ui/chart";
import { formatPct, formatPrice } from "@/lib/format";
import { padDomain } from "./price-chart";
import { HIST_SYNC, type CandleRow } from "./types";

/**
 * Candlesticks of the mid price. Recharts has no candle series, so each
 * candle is a floating bar over [low, high] with a custom shape: the bar's
 * pixel box gives the scale, the wick spans it and the body spans open→close.
 * Up candles (close ≥ open) use the buy tint, down candles the sell tint.
 */
export function CandleChart({
  data,
  label,
  bucketLabel,
}: {
  data: CandleRow[];
  label: string;
  bucketLabel: string;
}) {
  if (data.length < 2) {
    return (
      <ChartEmpty
        className="h-64 sm:h-80 lg:h-96"
        title="Not enough candles yet"
        hint={`Each candle is ${bucketLabel}. Try a shorter range, or check back once more data is in.`}
      />
    );
  }

  const config = { range: { label: "Mid OHLC", color: C.fg } } satisfies ChartConfig;
  const tick = timeTick(data[data.length - 1].t - data[0].t);

  return (
    <ChartFrame config={config} height="lg" label={label} interactive>
      <ComposedChart data={data} margin={MARGIN} syncId={HIST_SYNC} syncMethod="value" barCategoryGap="20%">
        <CartesianGrid {...GRID} />
        <XAxis dataKey="t" tickFormatter={tick} {...axisX} />
        <YAxis domain={padDomain} tickFormatter={(v: number) => formatPrice(v, 2)} {...axisY} />
        <ChartTooltip
          cursor={{ fill: "var(--color-muted)", opacity: 0.4 }}
          content={({ active, payload }) => {
            const row = payload?.[0]?.payload as CandleRow | undefined;
            if (!active || !row) return null;
            const chg = row.open ? (row.close - row.open) / row.open : null;
            return (
              <div className="grid min-w-36 gap-1 rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
                <div className="font-medium">{fullTime(row.t)}</div>
                {(
                  [
                    ["Open", row.open],
                    ["High", row.high],
                    ["Low", row.low],
                    ["Close", row.close],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{k}</span>
                    <span className="font-mono tabular-nums">{formatPrice(v, 2)}</span>
                  </div>
                ))}
                {chg != null && (
                  <div className="flex justify-between gap-3 border-t pt-1">
                    <span className="text-muted-foreground">Change</span>
                    <span
                      className={
                        chg > 0
                          ? "font-mono tabular-nums text-[color:var(--color-buy)]"
                          : chg < 0
                            ? "font-mono tabular-nums text-[color:var(--color-sell)]"
                            : "font-mono tabular-nums"
                      }
                    >
                      {formatPct(chg, { frac: 2, sign: true })}
                    </span>
                  </div>
                )}
              </div>
            );
          }}
        />
        <Bar
          dataKey="range"
          name="Mid OHLC"
          maxBarSize={14}
          isAnimationActive={false}
          shape={(props: unknown) => <CandleShape {...(props as CandleShapeProps)} />}
        />
        {data.length > 24 && (
          <Brush
            dataKey="t"
            height={26}
            travellerWidth={10}
            stroke="var(--color-border)"
            fill="var(--color-card)"
            tickFormatter={tick}
          />
        )}
      </ComposedChart>
    </ChartFrame>
  );
}

type CandleShapeProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: CandleRow;
};

function CandleShape({ x = 0, y = 0, width = 0, height = 0, payload }: CandleShapeProps) {
  if (!payload) return null;
  const { open, close, high, low } = payload;
  const span = high - low;
  // Pixel for a price: y is `high`, y + height is `low`.
  const py = (v: number) => (span > 0 ? y + ((high - v) / span) * height : y + height / 2);
  const up = close >= open;
  const color = up ? C.buy : C.sell;
  const cx = x + width / 2;
  const top = py(Math.max(open, close));
  const bodyH = Math.max(1, Math.abs(py(open) - py(close)));
  const bodyW = Math.max(1, width);
  return (
    <g>
      <line x1={cx} x2={cx} y1={py(high)} y2={py(low)} stroke={color} strokeWidth={1} />
      <rect
        x={x}
        y={top}
        width={bodyW}
        height={bodyH}
        rx={1}
        fill={color}
        fillOpacity={0.85}
        stroke={color}
        strokeWidth={0.5}
      />
    </g>
  );
}
