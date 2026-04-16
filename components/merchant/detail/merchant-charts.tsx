"use client";

import {
  Area,
  AreaChart,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCompact, formatFiat, formatPct } from "@/lib/format";

/**
 * Shape passed into every chart on the merchant detail page. Every field is
 * nullable because merchants drop in and out of the book — a tick where the
 * merchant wasn't listing still produces a row in this series (with nulls) so
 * gaps are visible in the X axis.
 */
export type MerchantPoint = {
  /** unix seconds */
  ts: number;
  bestBuy: number | null;
  bestSell: number | null;
  /** market-wide median at the same tick, for the overlay line */
  marketMid: number | null;
  /** total fiat depth across the merchant's ads at this tick */
  totalFiat: number | null;
  buyAds: number | null;
  sellAds: number | null;
};

function shortTime(ms: number, withDate = false) {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (!withDate) return `${hh}:${mm}`;
  const dd = String(d.getDate()).padStart(2, "0");
  const mo = d.toLocaleString("en", { month: "short" });
  return `${dd} ${mo} ${hh}:${mm}`;
}

const axisTick = {
  fill: "var(--color-muted-foreground)",
  fontSize: 10,
  fontFamily: "var(--font-mono)",
};

const tooltipStyles = {
  contentStyle: {
    background: "var(--color-popover)",
    border: "1px solid var(--color-border)",
    borderRadius: 8,
    fontSize: 11,
    padding: "8px 10px",
    boxShadow:
      "0 12px 40px -12px rgb(0 0 0 / 50%), 0 0 0 1px rgb(255 255 255 / 4%)",
  },
  labelStyle: {
    color: "var(--color-muted-foreground)",
    fontFamily: "var(--font-mono)" as const,
    marginBottom: 4,
  },
  itemStyle: { fontFamily: "var(--font-mono)" as const },
};

function EmptyChart({ height, msg }: { height: number; msg: string }) {
  return (
    <div
      style={{ height }}
      className="flex items-center justify-center rounded-md border border-dashed border-border/50 bg-card/40 text-center"
    >
      <div className="max-w-xs px-4 text-[11px] leading-relaxed text-muted-foreground">
        {msg}
      </div>
    </div>
  );
}

function Swatch({
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
    <span className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
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

/** 1 · Price chart — merchant's best BUY / best SELL with market median line. */
export function MerchantPriceChart({
  points,
  symbol,
}: {
  points: MerchantPoint[];
  symbol: string;
}) {
  const data = points.map((p) => ({
    t: p.ts * 1000,
    buy: p.bestBuy,
    sell: p.bestSell,
    mid: p.marketMid,
  }));
  const hasAny = data.some((d) => d.buy != null || d.sell != null);

  return (
    <Card className="card-lift border-border bg-card/60">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Their prices vs market
        </CardTitle>
        <div className="flex flex-wrap items-center gap-3">
          <Swatch color="var(--color-sell)" label="THEIR BUY" />
          <Swatch color="var(--color-buy)" label="THEIR SELL" />
          <Swatch color="var(--color-foreground)" label="MARKET MID" dashed dim />
        </div>
      </CardHeader>
      <CardContent>
        {!hasAny ? (
          <EmptyChart
            height={260}
            msg="Not enough price history for this merchant in the selected range."
          />
        ) : (
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={data}
                margin={{ top: 4, right: 24, left: 0, bottom: 0 }}
              >
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tick={axisTick}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => shortTime(Number(v))}
                />
                <YAxis
                  tick={axisTick}
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
                  {...tooltipStyles}
                  labelFormatter={(v) => shortTime(Number(v), true)}
                  formatter={(val, name) => {
                    const n = Number(val);
                    if (!Number.isFinite(n)) return ["—", name as string];
                    return [formatFiat(n, symbol, 2), name as string];
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="buy"
                  name="Their buy"
                  stroke="var(--color-sell)"
                  strokeWidth={1.75}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="sell"
                  name="Their sell"
                  stroke="var(--color-buy)"
                  strokeWidth={1.75}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="mid"
                  name="Market mid"
                  stroke="var(--color-foreground)"
                  strokeWidth={1}
                  strokeOpacity={0.4}
                  strokeDasharray="3 3"
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** 2 · Spread — `bestSell - bestBuy` over time. */
export function MerchantSpreadChart({
  points,
  symbol,
}: {
  points: MerchantPoint[];
  symbol: string;
}) {
  const data = points.map((p) => ({
    t: p.ts * 1000,
    spread:
      p.bestBuy != null && p.bestSell != null ? p.bestSell - p.bestBuy : null,
  }));
  const hasAny = data.some((d) => d.spread != null);

  return (
    <Card className="card-lift border-border bg-card/60">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Own spread
        </CardTitle>
        <span className="font-mono text-[10px] text-muted-foreground">
          sell − buy
        </span>
      </CardHeader>
      <CardContent>
        {!hasAny ? (
          <EmptyChart
            height={180}
            msg="Spread chart needs both a BUY and SELL ad at the same tick."
          />
        ) : (
          <div className="h-[180px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={data}
                margin={{ top: 4, right: 24, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="mSpreadFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-warn)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--color-warn)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tick={axisTick}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => shortTime(Number(v))}
                />
                <YAxis
                  tick={axisTick}
                  axisLine={false}
                  tickLine={false}
                  width={54}
                  tickFormatter={(v) => formatFiat(Number(v), symbol, 2)}
                />
                <Tooltip
                  {...tooltipStyles}
                  labelFormatter={(v) => shortTime(Number(v), true)}
                  formatter={(val) => [formatFiat(Number(val), symbol, 2), "Spread"]}
                />
                <Area
                  type="monotone"
                  dataKey="spread"
                  stroke="var(--color-warn)"
                  fill="url(#mSpreadFill)"
                  strokeWidth={1.5}
                  dot={false}
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

/** 3 · Premium vs market — positive = above median, negative = below. */
export function MerchantPremiumChart({ points }: { points: MerchantPoint[] }) {
  const data = points.map((p) => {
    const merchantMid =
      p.bestBuy != null && p.bestSell != null
        ? (p.bestBuy + p.bestSell) / 2
        : p.bestBuy ?? p.bestSell ?? null;
    const premium =
      merchantMid != null && p.marketMid != null && p.marketMid > 0
        ? (merchantMid - p.marketMid) / p.marketMid
        : null;
    return { t: p.ts * 1000, premium };
  });
  const hasAny = data.some((d) => d.premium != null);

  return (
    <Card className="card-lift border-border bg-card/60">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Premium vs market median
        </CardTitle>
        <span className="font-mono text-[10px] text-muted-foreground">
          above = more expensive
        </span>
      </CardHeader>
      <CardContent>
        {!hasAny ? (
          <EmptyChart
            height={180}
            msg="Not enough overlapping market data yet to compute a premium series."
          />
        ) : (
          <div className="h-[180px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={data}
                margin={{ top: 4, right: 24, left: 0, bottom: 0 }}
              >
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tick={axisTick}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => shortTime(Number(v))}
                />
                <YAxis
                  tick={axisTick}
                  axisLine={false}
                  tickLine={false}
                  width={50}
                  tickFormatter={(v) =>
                    formatPct(Number(v), { frac: 2, sign: true })
                  }
                />
                <Tooltip
                  {...tooltipStyles}
                  labelFormatter={(v) => shortTime(Number(v), true)}
                  formatter={(val) => [
                    formatPct(Number(val), { frac: 2, sign: true }),
                    "Premium",
                  ]}
                />
                <ReferenceLine
                  y={0}
                  stroke="var(--color-border)"
                  strokeDasharray="2 4"
                />
                <Line
                  type="monotone"
                  dataKey="premium"
                  stroke="var(--color-chart-4)"
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** 4 · Depth over time — total fiat available across all their ads. */
export function MerchantDepthChart({
  points,
  symbol,
}: {
  points: MerchantPoint[];
  symbol: string;
}) {
  const data = points.map((p) => ({
    t: p.ts * 1000,
    depth: p.totalFiat ?? 0,
  }));

  return (
    <Card className="card-lift border-border bg-card/60">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Depth over time
        </CardTitle>
        <span className="font-mono text-[10px] text-muted-foreground">
          fiat they can fill
        </span>
      </CardHeader>
      <CardContent>
        {data.length < 2 ? (
          <EmptyChart height={180} msg="No depth history for this range." />
        ) : (
          <div className="h-[180px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={data}
                margin={{ top: 4, right: 24, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="mDepthFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tick={axisTick}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => shortTime(Number(v))}
                />
                <YAxis
                  tick={axisTick}
                  axisLine={false}
                  tickLine={false}
                  width={54}
                  tickFormatter={(v) => `${symbol} ${formatCompact(Number(v))}`}
                />
                <Tooltip
                  {...tooltipStyles}
                  labelFormatter={(v) => shortTime(Number(v), true)}
                  formatter={(val) => [
                    `${symbol} ${formatCompact(Number(val))}`,
                    "Depth",
                  ]}
                />
                <Area
                  type="stepAfter"
                  dataKey="depth"
                  stroke="var(--color-primary)"
                  fill="url(#mDepthFill)"
                  strokeWidth={1.5}
                  dot={false}
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

/** 5 · Ad count — stacked BUY / SELL ad counts per tick. */
export function MerchantAdCountChart({ points }: { points: MerchantPoint[] }) {
  const data = points.map((p) => ({
    t: p.ts * 1000,
    buy: p.buyAds ?? 0,
    sell: p.sellAds ?? 0,
  }));
  const hasAny = data.some((d) => d.buy > 0 || d.sell > 0);

  return (
    <Card className="card-lift border-border bg-card/60">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Live ad count
        </CardTitle>
        <div className="flex items-center gap-3">
          <Swatch color="var(--color-sell)" label="BUY ADS" />
          <Swatch color="var(--color-buy)" label="SELL ADS" />
        </div>
      </CardHeader>
      <CardContent>
        {!hasAny ? (
          <EmptyChart height={180} msg="No ads observed in this range." />
        ) : (
          <div className="h-[180px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={data}
                margin={{ top: 4, right: 24, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="mAdBuyFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-sell)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--color-sell)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="mAdSellFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-buy)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--color-buy)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tick={axisTick}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => shortTime(Number(v))}
                  minTickGap={48}
                />
                <YAxis
                  tick={axisTick}
                  axisLine={false}
                  tickLine={false}
                  width={32}
                  allowDecimals={false}
                />
                <Tooltip
                  {...tooltipStyles}
                  labelFormatter={(v) => shortTime(Number(v), true)}
                  formatter={(val, name) => [String(val), name as string]}
                />
                <Area
                  type="stepAfter"
                  dataKey="buy"
                  stackId="ads"
                  stroke="var(--color-sell)"
                  fill="url(#mAdBuyFill)"
                  strokeWidth={1.25}
                  name="Buy ads"
                  isAnimationActive={false}
                />
                <Area
                  type="stepAfter"
                  dataKey="sell"
                  stackId="ads"
                  stroke="var(--color-buy)"
                  fill="url(#mAdSellFill)"
                  strokeWidth={1.25}
                  name="Sell ads"
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
