"use client";

import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatFiat } from "@/lib/format";
import { histogram, mean, stdev } from "@/lib/stats";

/**
 * Histogram of MID prices across the window, with mean and ±1σ markers.
 * Reveals whether the market is spending time above or below the live mid.
 */
export function PriceDistribution({
  mids,
  symbol,
}: {
  mids: number[];
  symbol: string;
}) {
  const { bins, counts, min, max } = histogram(mids, 18);
  const μ = mean(mids);
  const σ = stdev(mids);

  const data = bins.map((b, i) => ({ bin: b, count: counts[i] }));

  return (
    <Card className="card-lift border-border bg-card/60">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Price distribution
        </CardTitle>
        <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
          <span>μ {μ != null ? formatFiat(μ, symbol, 2) : "—"}</span>
          <span>σ {σ != null ? formatFiat(σ, symbol, 2) : "—"}</span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[180px] w-full">
          {mids.length < 2 ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              Not enough samples
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
              >
                <XAxis
                  dataKey="bin"
                  type="number"
                  domain={[min * 0.999, max * 1.001]}
                  tick={{
                    fill: "var(--color-muted-foreground)",
                    fontSize: 10,
                    fontFamily: "var(--font-mono)",
                  }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => formatFiat(Number(v), symbol, 2)}
                />
                <YAxis
                  tick={{
                    fill: "var(--color-muted-foreground)",
                    fontSize: 10,
                    fontFamily: "var(--font-mono)",
                  }}
                  axisLine={false}
                  tickLine={false}
                  width={30}
                />
                <Tooltip
                  cursor={{ fill: "var(--color-accent)", opacity: 0.4 }}
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
                  labelFormatter={(v) => formatFiat(Number(v), symbol, 2)}
                  formatter={(val) => [`${val} ticks`, "Frequency"]}
                />
                <Bar
                  dataKey="count"
                  fill="var(--color-primary)"
                  fillOpacity={0.45}
                  radius={[2, 2, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
