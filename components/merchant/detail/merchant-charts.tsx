"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  ANIM,
  C,
  ChartCard,
  ChartEmpty,
  ChartFrame,
  FadeGradient,
  GRID,
  MARGIN,
  TimeTooltip,
  ValueTooltip,
  axisX,
  axisY,
  spanOf,
  timeTick,
  type ChartConfig,
} from "@/components/charts/kit";
import { ChartContainer } from "@/components/ui/chart";
import { formatCompact, formatFiat, formatPct, formatCount } from "@/lib/format";
import { FIAT } from "@/lib/constants";

/**
 * One row of the merchant detail series. `t` is epoch ms (the kit's time
 * tooltip reads it). Merchant fields are null when they weren't listing at
 * that tick so gaps stay visible; market fields are forward-filled.
 */
export type MerchantPoint = {
  t: number;
  /** Their best buy-ad (bid) price. */
  bidPx: number | null;
  /** Their best sell-ad (ask) price. */
  askPx: number | null;
  mid: number | null;
  /** How far their ask is above the market's best ask (0 = they are best). */
  sellGap: number | null;
  /** How far their bid is below the market's best bid (0 = they are best). */
  buyGap: number | null;
  depth: number | null;
  buyAds: number | null;
  sellAds: number | null;
  orders: number | null;
};

const sym = FIAT.symbol;
const hasAny = (rows: MerchantPoint[], k: keyof MerchantPoint) =>
  rows.filter((r) => r[k] != null).length >= 2;

/* ── Price vs market ───────────────────────────────────────────────────── */

const priceCfg = {
  // Keys must not be "buy"/"sell": ChartContainer would redefine the
  // global --color-buy/--color-sell tokens inside the chart.
  askPx: { label: "Their sell ad", color: C.buy },
  bidPx: { label: "Their buy ad", color: C.sell },
  mid: { label: "Market mid", color: C.muted },
} satisfies ChartConfig;

export function PriceVsMarketChart({ points }: { points: MerchantPoint[] }) {
  const tick = timeTick(spanOf(points, (p) => p.t));
  const ok = hasAny(points, "bidPx") || hasAny(points, "askPx");
  return (
    <ChartCard
      title="Price vs market"
      description="Their best ad on each side against the market mid"
      legend={[
        { label: "Their sell ad", color: C.buy },
        { label: "Their buy ad", color: C.sell },
        { label: "Market mid", color: C.muted, dashed: true },
      ]}
    >
      {!ok ? (
        <ChartEmpty />
      ) : (
        <ChartFrame config={priceCfg} height="md" label="Merchant prices compared with the market mid over time">
          <LineChart data={points} margin={MARGIN}>
            <CartesianGrid {...GRID} />
            <XAxis {...axisX} dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={tick} />
            <YAxis {...axisY} domain={["auto", "auto"]} tickFormatter={(v: number) => v.toFixed(1)} />
            <TimeTooltip valueFormatter={(v) => formatFiat(v, sym, 2)} />
            <Line dataKey="mid" type="monotone" stroke="var(--color-mid)" strokeDasharray="4 4" strokeWidth={1.25} dot={false} connectNulls {...ANIM} />
            <Line dataKey="askPx" type="monotone" stroke="var(--color-askPx)" strokeWidth={1.75} dot={false} {...ANIM} />
            <Line dataKey="bidPx" type="monotone" stroke="var(--color-bidPx)" strokeWidth={1.75} dot={false} {...ANIM} />
          </LineChart>
        </ChartFrame>
      )}
    </ChartCard>
  );
}

/* ── Distance from best price ──────────────────────────────────────────── */

const gapCfg = {
  sellGap: { label: "Sell ad above best ask", color: C.buy },
  buyGap: { label: "Buy ad below best bid", color: C.sell },
} satisfies ChartConfig;

export function GapChart({ points }: { points: MerchantPoint[] }) {
  const tick = timeTick(spanOf(points, (p) => p.t));
  const ok = hasAny(points, "sellGap") || hasAny(points, "buyGap");
  return (
    <ChartCard
      title="Distance from best price"
      description="0 % means their ad was the best on the book"
      legend={[
        { label: "Sell ad vs best ask", color: C.buy },
        { label: "Buy ad vs best bid", color: C.sell },
      ]}
    >
      {!ok ? (
        <ChartEmpty />
      ) : (
        <ChartFrame config={gapCfg} height="sm" label="How far the merchant's prices are from the best market prices">
          <LineChart data={points} margin={MARGIN}>
            <CartesianGrid {...GRID} />
            <XAxis {...axisX} dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={tick} />
            <YAxis {...axisY} tickFormatter={(v: number) => formatPct(v, { frac: 1 })} />
            <TimeTooltip valueFormatter={(v) => formatPct(v, { frac: 2 })} />
            <Line dataKey="sellGap" type="monotone" stroke="var(--color-sellGap)" strokeWidth={1.75} dot={false} {...ANIM} />
            <Line dataKey="buyGap" type="monotone" stroke="var(--color-buyGap)" strokeWidth={1.75} dot={false} {...ANIM} />
          </LineChart>
        </ChartFrame>
      )}
    </ChartCard>
  );
}

/* ── Orders trend ──────────────────────────────────────────────────────── */

const ordersCfg = { orders: { label: "30-day orders", color: C.fg } } satisfies ChartConfig;

export function OrdersTrendChart({ points }: { points: MerchantPoint[] }) {
  const rows = points.filter((p) => p.orders != null);
  const tick = timeTick(spanOf(rows, (p) => p.t));
  const first = rows[0]?.orders ?? null;
  const last = rows[rows.length - 1]?.orders ?? null;
  return (
    <ChartCard
      title="Orders trend"
      description={
        first != null && last != null
          ? `30-day completed orders · ${last - first >= 0 ? "+" : ""}${formatCount(last - first)} in range`
          : "30-day completed orders"
      }
    >
      {rows.length < 2 ? (
        <ChartEmpty />
      ) : (
        <ChartFrame config={ordersCfg} height="sm" label="Thirty-day order count over time">
          <AreaChart data={rows} margin={MARGIN}>
            <defs>
              <FadeGradient id="m-orders" color={C.fg} from={0.18} />
            </defs>
            <CartesianGrid {...GRID} />
            <XAxis {...axisX} dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={tick} />
            <YAxis {...axisY} width={44} domain={["auto", "auto"]} allowDecimals={false} tickFormatter={(v: number) => formatCount(v)} />
            <TimeTooltip valueFormatter={(v) => formatCount(v)} />
            <Area dataKey="orders" type="stepAfter" stroke="var(--color-orders)" strokeWidth={1.5} fill="url(#m-orders)" {...ANIM} />
          </AreaChart>
        </ChartFrame>
      )}
    </ChartCard>
  );
}

/* ── Depth + ad count ──────────────────────────────────────────────────── */

const depthCfg = { depth: { label: "Listed amount", color: C.c2 } } satisfies ChartConfig;

export function DepthChart({ points }: { points: MerchantPoint[] }) {
  const tick = timeTick(spanOf(points, (p) => p.t));
  return (
    <ChartCard title="Listed amount" description={`Total ${sym} across their ads`}>
      {!hasAny(points, "depth") ? (
        <ChartEmpty />
      ) : (
        <ChartFrame config={depthCfg} height="sm" label="Merchant's listed amount over time">
          <AreaChart data={points} margin={MARGIN}>
            <defs>
              <FadeGradient id="m-depth" color={C.c2} />
            </defs>
            <CartesianGrid {...GRID} />
            <XAxis {...axisX} dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={tick} />
            <YAxis {...axisY} width={44} tickFormatter={(v: number) => formatCompact(v)} />
            <TimeTooltip valueFormatter={(v) => `${sym} ${formatCompact(v)}`} />
            <Area dataKey="depth" type="monotone" stroke="var(--color-depth)" strokeWidth={1.5} fill="url(#m-depth)" {...ANIM} />
          </AreaChart>
        </ChartFrame>
      )}
    </ChartCard>
  );
}

const adsCfg = {
  sellAds: { label: "Sell ads", color: C.buy },
  buyAds: { label: "Buy ads", color: C.sell },
} satisfies ChartConfig;

export function AdCountChart({ points }: { points: MerchantPoint[] }) {
  const tick = timeTick(spanOf(points, (p) => p.t));
  const ok = hasAny(points, "buyAds") || hasAny(points, "sellAds");
  return (
    <ChartCard
      title="Live ads"
      description="Number of ads they had up"
      legend={[
        { label: "Sell ads", color: C.buy },
        { label: "Buy ads", color: C.sell },
      ]}
    >
      {!ok ? (
        <ChartEmpty />
      ) : (
        <ChartFrame config={adsCfg} height="sm" label="Merchant's live ad count over time">
          <AreaChart data={points} margin={MARGIN}>
            <CartesianGrid {...GRID} />
            <XAxis {...axisX} dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={tick} />
            <YAxis {...axisY} width={28} allowDecimals={false} />
            <TimeTooltip valueFormatter={(v) => String(Math.round(v))} />
            <Area dataKey="sellAds" stackId="a" type="stepAfter" stroke="var(--color-sellAds)" fill="var(--color-sellAds)" fillOpacity={0.2} strokeWidth={1.5} {...ANIM} />
            <Area dataKey="buyAds" stackId="a" type="stepAfter" stroke="var(--color-buyAds)" fill="var(--color-buyAds)" fillOpacity={0.2} strokeWidth={1.5} {...ANIM} />
          </AreaChart>
        </ChartFrame>
      )}
    </ChartCard>
  );
}

/* ── Activity by hour (SLT) ────────────────────────────────────────────── */

const hourCfg = { sweeps: { label: "Sweeps listed", color: C.fg } } satisfies ChartConfig;

export function ActivityByHourChart({
  hours,
  source,
}: {
  /** 24 rows, hour 0–23 in Sri Lanka time. */
  hours: { hour: number; sweeps: number }[];
  source: string;
}) {
  const total = hours.reduce((s, h) => s + h.sweeps, 0);
  const peak = hours.reduce((a, b) => (b.sweeps > a.sweeps ? b : a), hours[0]);
  return (
    <ChartCard
      title="Activity by hour"
      description={
        total > 0
          ? `When they're usually listing (SLT) · busiest ${String(peak.hour).padStart(2, "0")}:00 · ${source}`
          : `When they're usually listing (SLT) · ${source}`
      }
    >
      {total === 0 ? (
        <ChartEmpty title="No activity recorded yet" hint="Fills in as the collector sees this merchant across the day." />
      ) : (
        <ChartFrame config={hourCfg} height="sm" label="Number of sweeps the merchant was listed in, by hour of day">
          <BarChart data={hours} margin={MARGIN}>
            <CartesianGrid {...GRID} />
            <XAxis {...axisX} dataKey="hour" minTickGap={4} tickFormatter={(h: number) => String(h).padStart(2, "0")} />
            <YAxis {...axisY} width={32} allowDecimals={false} />
            <ValueTooltip
              labelFormatter={(l) => `${String(l).padStart(2, "0")}:00 – ${String(l).padStart(2, "0")}:59`}
              valueFormatter={(v) => `${Math.round(v)} sweeps`}
            />
            <Bar dataKey="sweeps" fill="var(--color-sweeps)" fillOpacity={0.85} radius={[3, 3, 0, 0]} {...ANIM} />
          </BarChart>
        </ChartFrame>
      )}
    </ChartCard>
  );
}

/* ── Completion gauge ──────────────────────────────────────────────────── */

export function CompletionGauge({ rate, orders }: { rate: number | null; orders: number | null }) {
  const v = rate == null ? 0 : Math.max(0, Math.min(1, rate)) * 100;
  const color = rate == null ? C.muted : rate >= 0.95 ? C.buy : rate >= 0.85 ? C.warn : C.sell;
  return (
    <ChartCard title="Completion rate" description="Share of 30-day orders completed">
      <div className="relative mx-auto aspect-square w-full max-w-48">
        <ChartContainer
          config={{ v: { label: "Completion", color } }}
          className="aspect-square h-full w-full"
          role="img"
          aria-label={rate == null ? "Completion rate unknown" : `Completion rate ${formatPct(rate, { frac: 1 })}`}
        >
          <RadialBarChart data={[{ v }]} startAngle={90} endAngle={-270} innerRadius="78%" outerRadius="100%">
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} axisLine={false} />
            <RadialBar dataKey="v" background cornerRadius={8} fill={color} {...ANIM} />
          </RadialBarChart>
        </ChartContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-2xl font-semibold tabular-nums">
            {rate == null ? "—" : formatPct(rate, { frac: 1 })}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {orders != null ? `${formatCount(orders)} orders` : "no data"}
          </span>
        </div>
      </div>
    </ChartCard>
  );
}
