"use client";

import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCompact, formatSLT } from "@/lib/format";

export type OrderTrendPoint = {
  ts: number;
  ordersMonth: number | null;
  completionRate: number | null;
};

/**
 * Chart the flagged taker's rolling 30d order count over time. A rising line
 * after a community report is the clearest "they keep trading" signal and
 * usually the one that convinces merchants to take the registry seriously.
 * The dashed vertical line marks when the first report was filed.
 */
export function OrderTrendChart({
  points,
  firstReportTs,
}: {
  points: OrderTrendPoint[];
  firstReportTs: number | null;
}) {
  const data = points.map((p) => ({
    t: p.ts * 1000,
    orders: p.ordersMonth ?? null,
  }));
  const hasAny = data.some((d) => d.orders != null);

  return (
    <Card className="card-lift border-border bg-card/60">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          30d order count · over time
        </CardTitle>
        <span className="font-mono text-[10px] text-muted-foreground">
          rising = still trading
        </span>
      </CardHeader>
      <CardContent>
        {!hasAny ? (
          <div className="flex h-[220px] items-center justify-center rounded-md border border-dashed border-border/50 bg-card/40 text-center text-[11px] text-muted-foreground">
            Not enough listing history for this taker yet.
          </div>
        ) : (
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={data}
                margin={{ top: 4, right: 24, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="suspOrdersFill" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor="var(--color-sell)"
                      stopOpacity={0.4}
                    />
                    <stop
                      offset="100%"
                      stopColor="var(--color-sell)"
                      stopOpacity={0}
                    />
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
                  tickFormatter={(v) => formatSLT(new Date(Number(v)), { dateStyle: "short" })}
                  minTickGap={48}
                />
                <YAxis
                  tick={{
                    fill: "var(--color-muted-foreground)",
                    fontSize: 10,
                    fontFamily: "var(--font-mono)",
                  }}
                  axisLine={false}
                  tickLine={false}
                  width={40}
                  tickFormatter={(v) => formatCompact(Number(v))}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 11,
                    padding: "8px 10px",
                  }}
                  labelFormatter={(v) =>
                    formatSLT(new Date(Number(v)))
                  }
                  formatter={(val) => [formatCompact(Number(val)), "Orders 30d"]}
                />
                {firstReportTs != null && (
                  <ReferenceLine
                    x={firstReportTs * 1000}
                    stroke="var(--color-warn)"
                    strokeDasharray="4 4"
                    label={{
                      value: "First report",
                      position: "top",
                      fill: "var(--color-warn)",
                      fontSize: 9,
                      fontFamily: "var(--font-mono)",
                    }}
                  />
                )}
                <Area
                  type="monotone"
                  dataKey="orders"
                  stroke="var(--color-sell)"
                  fill="url(#suspOrdersFill)"
                  strokeWidth={1.75}
                  connectNulls
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
