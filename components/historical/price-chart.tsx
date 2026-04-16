"use client";

import {
  Area,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatFiat } from "@/lib/format";
import { sma } from "@/lib/stats";

export type HistoryPoint = {
  ts: number;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  spreadPct: number | null;
  bidDepth: number | null;
  askDepth: number | null;
};

export function PriceChart({
  points,
  symbol,
  asset,
  showMovingAverages = true,
}: {
  points: HistoryPoint[];
  symbol: string;
  asset: string;
  showMovingAverages?: boolean;
}) {
  const midSeries = points.map((p) => p.mid);
  const ma20 = sma(midSeries, 20);
  const ma60 = sma(midSeries, 60);

  const data = points.map((p, i) => ({
    t: p.ts * 1000,
    bid: p.bid,
    ask: p.ask,
    mid: p.mid,
    ma20: showMovingAverages ? ma20[i] : null,
    ma60: showMovingAverages ? ma60[i] : null,
  }));

  const latest = points[points.length - 1];

  return (
    <Card className="card-lift border-border bg-card/60">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Price history
        </CardTitle>
        <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
          {/* Retail-centric palette: Buy Ads (publisher buying) = red,
              Sell Ads (publisher selling = retail buying) = green. */}
          <LegendSwatch color="var(--color-sell)" label="BUY ADS" />
          <LegendSwatch color="var(--color-buy)" label="SELL ADS" />
          <LegendSwatch color="var(--color-foreground)" label="MID" dim />
          {showMovingAverages && (
            <>
              <LegendSwatch color="var(--color-chart-4)" label="MA20" dashed />
              <LegendSwatch color="var(--color-chart-5)" label="MA60" dashed />
            </>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[320px] w-full">
          {data.length < 2 ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={data}
                margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="bidAreaFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-sell)" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="var(--color-sell)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="askAreaFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-buy)" stopOpacity={0.28} />
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
                  tickFormatter={(v) => shortTime(Number(v))}
                />
                <YAxis
                  tick={{
                    fill: "var(--color-muted-foreground)",
                    fontSize: 10,
                    fontFamily: "var(--font-mono)",
                  }}
                  axisLine={false}
                  tickLine={false}
                  width={64}
                  domain={[
                    (min: number) => min * 0.999,
                    (max: number) => max * 1.001,
                  ]}
                  tickFormatter={(v) => formatFiat(Number(v), symbol, 2)}
                />
                <Tooltip
                  cursor={{ stroke: "var(--color-border)", strokeWidth: 1 }}
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 11,
                    padding: "8px 10px",
                    boxShadow:
                      "0 12px 40px -12px rgb(0 0 0 / 50%), 0 0 0 1px rgb(255 255 255 / 4%)",
                  }}
                  labelStyle={{
                    color: "var(--color-muted-foreground)",
                    fontFamily: "var(--font-mono)",
                    marginBottom: 4,
                  }}
                  itemStyle={{ fontFamily: "var(--font-mono)" }}
                  labelFormatter={(v) => shortTime(Number(v), true)}
                  formatter={(val, name) => {
                    const n = Number(val);
                    if (!Number.isFinite(n)) return ["—", name as string];
                    return [formatFiat(n, symbol, 2), name as string];
                  }}
                />
                {latest?.mid != null && (
                  <ReferenceLine
                    y={latest.mid}
                    stroke="var(--color-border)"
                    strokeDasharray="2 4"
                  />
                )}
                <Area
                  type="monotone"
                  dataKey="bid"
                  name="Buy Ads"
                  stroke="var(--color-sell)"
                  fill="url(#bidAreaFill)"
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
                <Area
                  type="monotone"
                  dataKey="ask"
                  name="Sell Ads"
                  stroke="var(--color-buy)"
                  fill="url(#askAreaFill)"
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="mid"
                  name="MID"
                  stroke="var(--color-foreground)"
                  strokeWidth={1}
                  strokeOpacity={0.35}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
                {showMovingAverages && (
                  <>
                    <Line
                      type="monotone"
                      dataKey="ma20"
                      name="MA20"
                      stroke="var(--color-chart-4)"
                      strokeWidth={1}
                      strokeDasharray="3 3"
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="ma60"
                      name="MA60"
                      stroke="var(--color-chart-5)"
                      strokeWidth={1}
                      strokeDasharray="3 3"
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  </>
                )}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
      <div className="sr-only">{asset}</div>
    </Card>
  );
}

function LegendSwatch({
  color,
  label,
  dim,
  dashed,
}: {
  color: string;
  label: string;
  dim?: boolean;
  dashed?: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        aria-hidden
        className="inline-block h-[3px] w-3 rounded-full"
        style={{
          backgroundColor: dashed ? "transparent" : color,
          opacity: dim ? 0.45 : 1,
          borderTop: dashed ? `2px dashed ${color}` : undefined,
        }}
      />
      {label}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border/50 bg-card/40 px-6 text-center">
      <div className="max-w-md">
        <div className="text-sm font-medium text-foreground">
          Not enough history yet
        </div>
        <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          Run{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
            npm run ingest:loop
          </code>{" "}
          to start accumulating snapshots, or wait for the cron to tick.
        </div>
      </div>
    </div>
  );
}

function shortTime(ms: number, withDate = false) {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (!withDate) return `${hh}:${mm}`;
  const dd = String(d.getDate()).padStart(2, "0");
  const mo = d.toLocaleString("en", { month: "short" });
  return `${dd} ${mo} ${hh}:${mm}`;
}
