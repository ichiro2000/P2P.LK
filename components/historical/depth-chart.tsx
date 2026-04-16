"use client";

import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCompact } from "@/lib/format";
import type { HistoryPoint } from "./price-chart";

/**
 * Stacked BID / ASK depth over time. Useful for spotting liquidity drops
 * or one-sided book imbalance that persists across ticks.
 */
export function DepthChart({
  points,
  asset,
}: {
  points: HistoryPoint[];
  asset: string;
}) {
  const data = points.map((p) => ({
    t: p.ts * 1000,
    bid: p.bidDepth ?? 0,
    ask: p.askDepth ?? 0,
  }));

  return (
    <Card className="card-lift border-border bg-card/60">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Depth over time
        </CardTitle>
        <span className="font-mono text-[10px] text-muted-foreground">
          top-20 cumulative ({asset})
        </span>
      </CardHeader>
      <CardContent>
        <div className="h-[200px] w-full">
          {data.length < 2 ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              No depth history yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={data}
                margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="bidDepthFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-sell)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--color-sell)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="askDepthFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-buy)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--color-buy)" stopOpacity={0} />
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
                  dataKey="bid"
                  name="Buy Ads"
                  stackId="1"
                  stroke="var(--color-sell)"
                  fill="url(#bidDepthFill)"
                  strokeWidth={1.25}
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="ask"
                  name="Sell Ads"
                  stackId="1"
                  stroke="var(--color-buy)"
                  fill="url(#askDepthFill)"
                  strokeWidth={1.25}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
