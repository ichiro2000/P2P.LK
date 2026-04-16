"use client";

import {
  Area,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCompact } from "@/lib/format";
import { sma } from "@/lib/stats";

export type DepthPoint = {
  ts: number;
  bidDepth: number | null;
  askDepth: number | null;
};

/**
 * Depth (BID+ASK) over time with a rolling-20 SMA line.
 * Surfaces macro liquidity trends that a single snapshot can't.
 */
export function DepthTrend({
  points,
  asset,
}: {
  points: DepthPoint[];
  asset: string;
}) {
  const totals = points.map((p) =>
    (p.bidDepth ?? 0) + (p.askDepth ?? 0),
  );
  const ma = sma(totals, 20);

  const data = points.map((p, i) => ({
    t: p.ts * 1000,
    total: totals[i],
    ma: ma[i],
  }));

  const hasData = data.length >= 2;

  return (
    <Card className="card-lift border-border bg-card/60">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Total depth trend
        </CardTitle>
        <span className="font-mono text-[10px] text-muted-foreground">
          Buy + Sell ads ({asset}) · SMA20
        </span>
      </CardHeader>
      <CardContent>
        <div className="h-[200px] w-full">
          {!hasData ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              Waiting for enough snapshots…
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={data}
                margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="totalDepthFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tick={{
                    fill: "var(--color-muted-foreground)",
                    fontSize: 10,
                    fontFamily: "var(--font-mono)",
                  }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => {
                    const d = new Date(Number(v));
                    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
                  }}
                />
                <YAxis
                  tick={{
                    fill: "var(--color-muted-foreground)",
                    fontSize: 10,
                    fontFamily: "var(--font-mono)",
                  }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                  tickFormatter={(v) => formatCompact(Number(v))}
                />
                <Tooltip
                  cursor={{ stroke: "var(--color-border)", strokeWidth: 1 }}
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 11,
                    padding: "8px 10px",
                  }}
                  labelStyle={{
                    color: "var(--color-muted-foreground)",
                    fontFamily: "var(--font-mono)",
                    marginBottom: 4,
                  }}
                  itemStyle={{ fontFamily: "var(--font-mono)" }}
                  labelFormatter={(v) => new Date(Number(v)).toLocaleString()}
                  formatter={(val, name) => [
                    `${formatCompact(Number(val))} ${asset}`,
                    name as string,
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  name="Depth"
                  stroke="var(--color-primary)"
                  fill="url(#totalDepthFill)"
                  strokeWidth={1.5}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="ma"
                  name="SMA20"
                  stroke="var(--color-chart-4)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
