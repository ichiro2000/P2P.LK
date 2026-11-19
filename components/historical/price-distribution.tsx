"use client";

import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, XAxis, YAxis } from "recharts";
import {
  ANIM,
  C,
  ChartEmpty,
  ChartFrame,
  GRID,
  MARGIN,
  ValueTooltip,
  axisX,
  axisY,
  type ChartConfig,
} from "@/components/charts/kit";
import { histogram, mean } from "@/lib/stats";
import { formatPrice } from "@/lib/format";

/**
 * How often the mid sat at each price over the visible window. The bin
 * holding the latest mid is drawn solid; a dashed line marks the average.
 */
export function PriceDistribution({ mids, label }: { mids: number[]; label: string }) {
  if (mids.length < 4) return <ChartEmpty className="h-44 sm:h-52" />;

  const bins = Math.min(24, Math.max(6, Math.round(Math.sqrt(mids.length) * 2)));
  const h = histogram(mids, bins);
  const width = h.bins.length > 1 ? h.bins[1] - h.bins[0] : 1;
  const last = mids[mids.length - 1];
  const avg = mean(mids);
  const total = mids.length;
  const data = h.bins.map((b, i) => ({
    price: Number(b.toFixed(3)),
    share: (h.counts[i] / total) * 100,
    current: Math.abs(b - last) <= width / 2 + 1e-9,
  }));
  const config = { share: { label: "Time at price", color: C.c2 } } satisfies ChartConfig;

  return (
    <ChartFrame config={config} height="sm" label={label}>
      <BarChart data={data} margin={MARGIN} barCategoryGap={2}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="price" tickFormatter={(v: number) => formatPrice(v, 2)} {...axisX} />
        <YAxis tickFormatter={(v: number) => `${Math.round(v)}%`} {...axisY} width={36} />
        <ValueTooltip
          labelFormatter={(l) => `Rs ${formatPrice(Number(l), 2)}`}
          valueFormatter={(v) => `${v.toFixed(1)}% of the time`}
        />
        {avg != null && h.bins.length > 1 && (
          <ReferenceLine
            x={data.reduce((best, d) => (Math.abs(d.price - avg) < Math.abs(best.price - avg) ? d : best)).price}
            stroke="var(--color-muted-foreground)"
            strokeDasharray="3 3"
            label={{ value: "avg", position: "top", fill: "var(--color-muted-foreground)", fontSize: 10 }}
          />
        )}
        <Bar dataKey="share" name="Time at price" radius={[3, 3, 0, 0]} {...ANIM}>
          {data.map((d) => (
            <Cell key={d.price} fill={d.current ? C.fg : C.c4} />
          ))}
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}
