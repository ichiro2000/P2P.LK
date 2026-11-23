"use client";

import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import { ChartTooltip } from "@/components/ui/chart";
import {
  ANIM,
  ChartEmpty,
  ChartFrame,
  GRID,
  MARGIN,
  axisX,
  axisY,
  type ChartConfig,
  type LegendItem,
} from "@/components/charts/kit";
import { Segmented } from "@/components/market/segmented";
import { formatInt, formatCount } from "@/lib/format";
import { TRADE_SIDES, dayIso, type Period } from "@/lib/trade-trend";

/**
 * Stacked buy/sell bars for completed trades per day / week / month, shared
 * by the merchant page and the market-wide activity section.
 *
 * Sides are the MERCHANT's: a completed buy order = the merchant bought USDT
 * (the user sold). Colours follow the site convention — green is the side
 * where users buy USDT, so "merchant sold USDT" is green, "merchant bought
 * USDT" red.
 *
 * Buckets without data are left empty (never drawn as 0). Estimated (gap
 * spread), partly covered and still-running buckets are drawn faded.
 */

export type TrendBucketLike = {
  start: number;
  end: number;
  label: string;
  buy: number | null;
  sell: number | null;
  total: number | null;
  daysCovered: number;
  daysElapsed: number;
  complete: boolean;
  inProgress: boolean;
  estimated: boolean;
  merchants: number;
};

const SIDE = TRADE_SIDES;

export const TRADE_LEGEND: LegendItem[] = [
  { label: `${SIDE.sold.label} (${SIDE.sold.hint})`, color: SIDE.sold.color },
  { label: `${SIDE.bought.label} (${SIDE.bought.hint})`, color: SIDE.bought.color },
];

export const PERIOD_OPTIONS = [
  { value: "day" as const, label: "Daily" },
  { value: "week" as const, label: "Weekly" },
  { value: "month" as const, label: "Monthly" },
];

export function PeriodToggle({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return <Segmented label="Trend period" value={value} options={PERIOD_OPTIONS} onChange={onChange} />;
}

// Keys must not be "buy"/"sell": ChartContainer would redefine the global
// --color-buy/--color-sell tokens inside the chart.
const cfg = {
  mSold: { label: SIDE.sold.label, color: SIDE.sold.color },
  mBought: { label: SIDE.bought.label, color: SIDE.bought.color },
} satisfies ChartConfig;

type Status = "measured" | "estimated" | "partial" | "running";
type Point = {
  label: string;
  start: number;
  end: number;
  mSold: number | null;
  mBought: number | null;
  status: Status;
  covered: number;
  elapsed: number;
  merchants: number;
};

const statusOf = (b: TrendBucketLike): Status =>
  b.inProgress ? "running" : !b.complete ? "partial" : b.estimated ? "estimated" : "measured";

const STATUS_TEXT: Record<Status, string> = {
  measured: "Measured",
  estimated: "Includes days estimated from a collection gap",
  partial: "Partial: not every day was collected",
  running: "So far (period still running)",
};

const periodRange = (period: Period, p: Point) =>
  period === "day" ? dayIso(p.start) : `${dayIso(p.start)} – ${dayIso(p.end)}`;

export function TradeBars({
  buckets,
  period,
  showMerchants = false,
  emptyHint,
  label,
}: {
  buckets: readonly TrendBucketLike[];
  period: Period;
  /** Market view: show how many merchants each bar sums. */
  showMerchants?: boolean;
  emptyHint: string;
  label: string;
}) {
  const data: Point[] = buckets.map((b) => ({
    label: b.label,
    start: b.start,
    end: b.end,
    mSold: b.sell == null ? null : Math.round(b.sell),
    mBought: b.buy == null ? null : Math.round(b.buy),
    status: statusOf(b),
    covered: b.daysCovered,
    elapsed: b.daysElapsed,
    merchants: b.merchants,
  }));
  if (!data.some((d) => d.mSold != null)) {
    return <ChartEmpty title="No trade differences yet" hint={emptyHint} />;
  }
  const faded = (p: Point) => (p.status === "measured" ? 1 : 0.45);
  return (
    <ChartFrame config={cfg} height="md" label={label}>
      <BarChart data={data} margin={MARGIN} barCategoryGap="18%">
        <CartesianGrid {...GRID} />
        <XAxis {...axisX} dataKey="label" interval="preserveStartEnd" />
        <YAxis {...axisY} width={44} allowDecimals={false} tickFormatter={(v: number) => formatCount(v)} />
        <ChartTooltip
          cursor={{ fill: "var(--color-muted)", opacity: 0.5 }}
          content={({ active, payload }) => {
            const p = active ? (payload?.[0]?.payload as Point | undefined) : undefined;
            if (!p) return null;
            const total = (p.mSold ?? 0) + (p.mBought ?? 0);
            return (
              <div className="grid min-w-44 gap-1 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
                <div className="font-medium">{periodRange(period, p)}</div>
                {p.mSold == null ? (
                  <div className="text-muted-foreground">No data for this {period}</div>
                ) : (
                  <>
                    {(
                      [
                        ["mSold", SIDE.sold],
                        ["mBought", SIDE.bought],
                      ] as const
                    ).map(([k, s]) => (
                      <div key={k} className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <span className="size-2 shrink-0 rounded-[2px]" style={{ background: s.color }} />
                          {s.label}
                        </span>
                        <span className="font-mono font-medium tabular-nums text-foreground">{formatInt(p[k])}</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between gap-3 border-t border-border pt-1">
                      <span className="text-muted-foreground">Total</span>
                      <span className="font-mono font-medium tabular-nums">{formatInt(total)}</span>
                    </div>
                    {showMerchants && (
                      <div className="text-muted-foreground">Up to {formatInt(p.merchants)} merchants measured</div>
                    )}
                    {p.status !== "measured" && (
                      <div className="text-[color:var(--color-warn)]">
                        {STATUS_TEXT[p.status]}
                        {p.status === "partial" ? ` (${p.covered}/${p.elapsed} days)` : ""}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          }}
        />
        <Bar dataKey="mSold" stackId="t" fill="var(--color-mSold)" {...ANIM}>
          {data.map((p) => (
            <Cell key={p.start} fillOpacity={faded(p)} />
          ))}
        </Bar>
        <Bar dataKey="mBought" stackId="t" fill="var(--color-mBought)" radius={[3, 3, 0, 0]} {...ANIM}>
          {data.map((p) => (
            <Cell key={p.start} fillOpacity={faded(p)} />
          ))}
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}

/** "+12.5 %" style growth text, or null. */
export function growthText(g: number | null | undefined) {
  if (g == null || !Number.isFinite(g)) return null;
  return `${g > 0 ? "+" : ""}${(g * 100).toFixed(1)}%`;
}

/** KPI label: "Trades today", "Trades yesterday", "Trades this week"… */
export function tradesLabel(p: Period, kind: "this" | "last") {
  if (p === "day") return kind === "this" ? "Trades today" : "Trades yesterday";
  return `Trades ${kind} ${p}`;
}

/** Shown while two full periods aren't collected yet. */
export const needsDataText = (p: Period) => `Shows once we have 2 full ${p}s of data`;

export function periodWord(p: Period, kind: "this" | "last") {
  const n = p === "day" ? (kind === "this" ? "Today" : "Yesterday") : p === "week" ? "week" : "month";
  if (p === "day") return n;
  return kind === "this" ? `This ${n}` : `Last ${n}`;
}
