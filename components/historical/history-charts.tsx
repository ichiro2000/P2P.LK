"use client";

import { useDeferredValue, useState } from "react";
import { CandlestickChart, ChartArea, GitCompareArrows, RotateCcw } from "lucide-react";
import { C, ChartCard, type LegendItem } from "@/components/charts/kit";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toggle } from "@/components/ui/toggle";
import { Button } from "@/components/ui/button";
import { formatPct, formatPrice } from "@/lib/format";
import { PriceChart, type PriceSeries } from "./price-chart";
import { CandleChart } from "./candle-chart";
import { SpreadChart } from "./spread-chart";
import { DepthChart, type DepthBand } from "./depth-chart";
import { PriceDistribution } from "./price-distribution";
import type { CandleRow, HistRow } from "./types";

export type HistInputPoint = {
  ts: number;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  spreadPct: number | null;
  bidDepth: number | null;
  askDepth: number | null;
  bidDepth1: number | null;
  askDepth1: number | null;
  bidDepth05: number | null;
  askDepth05: number | null;
};

export type HistInputCandle = {
  ts: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
};

type View = "line" | "candles";

/**
 * Every chart on the Historical page. One brush (under the price chart)
 * sets the window for spread, depth and distribution; all time charts share
 * a crosshair (recharts `syncId`, matched by timestamp).
 *
 * Mount with a `key` per exchange + range so state resets on navigation.
 */
export function HistoryCharts({
  points,
  compare,
  candles,
  exLabel,
  otherLabel,
  asset,
  candleLabel,
  ma,
}: {
  /** Time-based moving averages of the mid, aligned with `points`. */
  ma: { labels: [string, string]; a: (number | null)[]; b: (number | null)[] };
  points: HistInputPoint[];
  compare: { ts: number; mid: number | null; spreadPct: number | null }[] | null;
  candles: HistInputCandle[];
  exLabel: string;
  otherLabel: string;
  asset: string;
  candleLabel: string;
}) {
  const rows = toRows(points, compare, ma);
  const candleRows = toCandles(candles);
  const full = { start: 0, end: Math.max(0, rows.length - 1) };

  const [view, setView] = useState<View>("line");
  const [overlay, setOverlay] = useState(false);
  const [hidden, setHidden] = useState<ReadonlySet<PriceSeries>>(() => new Set());
  const [brush, setBrush] = useState(full);
  const [brushKey, setBrushKey] = useState(0);
  const [band, setBand] = useState<DepthBand>(() =>
    points.some((p) => p.askDepth1 != null || p.bidDepth1 != null) ? "1" : "top20",
  );
  const win = useDeferredValue(brush);

  const zoomed = brush.start > 0 || brush.end < rows.length - 1;
  const visible = zoomed ? rows.slice(win.start, win.end + 1) : rows;
  const mids = visible.map((r) => r.mid).filter((v): v is number => v != null);
  const hasCompare = rows.some((r) => r.cmp != null);

  const toggle = (k: PriceSeries) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const resetZoom = () => {
    setBrush(full);
    setBrushKey((k) => k + 1);
  };

  const legend: LegendItem[] =
    view === "candles"
      ? [
          { label: "Up", color: C.buy },
          { label: "Down", color: C.sell },
        ]
      : overlay
        ? [
            { label: `${exLabel} mid`, color: C.fg },
            { label: `${otherLabel} mid`, color: C.c3, dashed: true },
          ]
        : (
            [
              ["bid", "Buy ads", C.sell, false],
              ["ask", "Sell ads", C.buy, false],
              ["mid", "Mid", C.fg, false],
              ["maA", ma.labels[0], C.c3, true],
              ["maB", ma.labels[1], C.c4, true],
            ] as const
          ).map(([k, label, color, dashed]) => ({
            label,
            color,
            dashed,
            hidden: hidden.has(k),
            onClick: () => toggle(k),
          }));

  const premium = latestPremium(rows);
  const first = mids[0];
  const last = mids[mids.length - 1];

  return (
    <div className="space-y-4">
      <ChartCard
        title={view === "candles" ? `Mid price candles · ${candleLabel}` : overlay ? `${exLabel} vs ${otherLabel}` : "Price"}
        description={
          view === "candles"
            ? "Open, high, low and close of the mid price per candle."
            : overlay
              ? premium
                ? `${otherLabel} mid is ${formatPrice(Math.abs(premium.diff), 2)} LKR (${formatPct(Math.abs(premium.pct), { frac: 2 })}) ${premium.diff >= 0 ? "above" : "below"} ${exLabel} right now.`
                : `Mid price on both exchanges, same time grid.`
              : `Best Buy-ad and Sell-ad prices with the mid and its ${ma.labels[0]} / ${ma.labels[1]} (time-based, blank until a full window or across gaps). Gaps mean no data was recorded. Tap a legend item to hide it.`
        }
        legend={legend}
        actions={
          <>
            <Tabs value={view} onValueChange={(v) => setView(v as View)}>
              <TabsList aria-label="Chart type">
                <TabsTrigger value="line" className="px-2.5 text-xs">
                  <ChartArea className="size-3.5" aria-hidden />
                  Line
                </TabsTrigger>
                <TabsTrigger value="candles" className="px-2.5 text-xs">
                  <CandlestickChart className="size-3.5" aria-hidden />
                  Candles
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Toggle
              variant="outline"
              size="sm"
              pressed={overlay}
              onPressedChange={setOverlay}
              disabled={!hasCompare || view === "candles"}
              aria-label={`Compare vs ${otherLabel}`}
              title={hasCompare ? `Overlay ${otherLabel} mid price` : `No ${otherLabel} data for this range yet`}
            >
              <GitCompareArrows aria-hidden />
              vs {otherLabel}
            </Toggle>
          </>
        }
        footer={
          view === "line" && rows.length > 8 ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                Drag the handles under the chart to zoom — spread, depth and distribution follow.
                {zoomed && first != null && last != null && (
                  <>
                    {" "}
                    Window change{" "}
                    <span className="font-mono tabular-nums text-foreground">
                      {formatPct((last - first) / first, { frac: 2, sign: true })}
                    </span>
                    .
                  </>
                )}
              </span>
              {zoomed && (
                <Button variant="ghost" size="sm" onClick={resetZoom} className="h-7 px-2 text-xs">
                  <RotateCcw className="size-3.5" aria-hidden />
                  Reset zoom
                </Button>
              )}
            </div>
          ) : undefined
        }
      >
        {view === "candles" ? (
          <CandleChart
            data={candleRows}
            bucketLabel={candleLabel}
            label={`Candlestick chart of the ${asset}/LKR mid price on ${exLabel}, ${candleRows.length} candles of ${candleLabel}.`}
          />
        ) : (
          <PriceChart
            key={brushKey}
            data={rows}
            hidden={hidden}
            overlay={overlay}
            exLabel={exLabel}
            otherLabel={otherLabel}
            brush={brush}
            onBrush={setBrush}
            label={describePrice(rows, exLabel, otherLabel, overlay)}
            maLabels={ma.labels}
          />
        )}
      </ChartCard>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ChartCard
          title="Spread"
          description="Gap between the best Sell ad and best Buy ad, as % of mid. Below zero = crossed book."
          legend={
            overlay
              ? [
                  { label: exLabel, color: C.fg },
                  { label: otherLabel, color: C.c3, dashed: true },
                ]
              : undefined
          }
        >
          <SpreadChart
            data={visible}
            overlay={overlay}
            exLabel={exLabel}
            otherLabel={otherLabel}
            label={describeSeries(visible, "spread", "Spread", (v) => `${v.toFixed(2)}%`)}
          />
        </ChartCard>
        <ChartCard
          title="Depth"
          description={
            band === "top20"
              ? `${asset} in the top 20 ads per side (old measure: includes far-off and placeholder ads).`
              : `${asset} within ${band === "1" ? "1%" : "0.5%"} of each side's best price. Buy ads are declared, not escrowed.`
          }
          legend={[
            { label: "Buy ads (declared)", color: C.sell },
            { label: "Sell ads", color: C.buy },
          ]}
          actions={
            <Tabs value={band} onValueChange={(v) => setBand(v as DepthBand)}>
              <TabsList aria-label="Depth measure">
                <TabsTrigger value="05" className="px-2 text-xs">±0.5%</TabsTrigger>
                <TabsTrigger value="1" className="px-2 text-xs">±1%</TabsTrigger>
                <TabsTrigger value="top20" className="px-2 text-xs">Top 20</TabsTrigger>
              </TabsList>
            </Tabs>
          }
        >
          <DepthChart
            data={visible}
            asset={asset}
            band={band}
            label={describeSeries(
              visible,
              band === "1" ? "askDepth1" : band === "05" ? "askDepth05" : "askDepth",
              band === "top20" ? "Sell-ad top-20 depth" : `Sell-ad depth within ${band === "1" ? "1%" : "0.5%"}`,
              (v) => `${Math.round(v)} ${asset}`,
            )}
          />
        </ChartCard>
        <ChartCard
          title="Price distribution"
          description="Share of time the mid spent at each price in the window."
          className="md:col-span-2 xl:col-span-1"
        >
          <PriceDistribution
            mids={mids}
            label={
              mids.length
                ? `Histogram of ${mids.length} mid prices between ${formatPrice(Math.min(...mids), 2)} and ${formatPrice(Math.max(...mids), 2)} LKR.`
                : "No prices yet."
            }
          />
        </ChartCard>
      </div>
    </div>
  );
}

function toRows(
  points: HistInputPoint[],
  compare: { ts: number; mid: number | null; spreadPct: number | null }[] | null,
  ma: { a: (number | null)[]; b: (number | null)[] },
): HistRow[] {
  const cmp = new Map((compare ?? []).map((c) => [c.ts, c]));
  const own = new Set(points.map((p) => p.ts));
  // Both series sit on the same filled grid, so this is normally empty; it
  // keeps any compare-only bucket inside our own time span.
  const first = points[0]?.ts ?? 0;
  const last = points[points.length - 1]?.ts ?? 0;
  const extra: HistRow[] = (compare ?? [])
    .filter((c) => !own.has(c.ts) && c.ts >= first && c.ts <= last)
    .map((c) => ({
      t: c.ts * 1000,
      bid: null,
      ask: null,
      mid: null,
      maA: null,
      maB: null,
      cmp: c.mid,
      spread: null,
      cmpSpread: c.spreadPct != null ? c.spreadPct * 100 : null,
      bidDepth: null,
      askDepth: null,
      bidDepth1: null,
      askDepth1: null,
      bidDepth05: null,
      askDepth05: null,
    }));
  const base = points.map((p, i) => {
    const c = cmp.get(p.ts);
    return {
      t: p.ts * 1000,
      bid: p.bid,
      ask: p.ask,
      mid: p.mid,
      maA: ma.a[i] ?? null,
      maB: ma.b[i] ?? null,
      cmp: c?.mid ?? null,
      spread: p.spreadPct != null ? p.spreadPct * 100 : null,
      cmpSpread: c?.spreadPct != null ? c.spreadPct * 100 : null,
      bidDepth: p.bidDepth,
      askDepth: p.askDepth,
      bidDepth1: p.bidDepth1,
      askDepth1: p.askDepth1,
      bidDepth05: p.bidDepth05,
      askDepth05: p.askDepth05,
    };
  });
  return extra.length ? [...base, ...extra].sort((a, b) => a.t - b.t) : base;
}

function toCandles(candles: HistInputCandle[]): CandleRow[] {
  const out: CandleRow[] = [];
  for (const c of candles) {
    if (c.open == null || c.high == null || c.low == null || c.close == null) continue;
    out.push({
      t: c.ts * 1000,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      range: [c.low, c.high],
    });
  }
  return out;
}

function latestPremium(rows: HistRow[]) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.mid != null && r.cmp != null && r.mid > 0) {
      return { diff: r.cmp - r.mid, pct: (r.cmp - r.mid) / r.mid };
    }
  }
  return null;
}

function describeSeries(
  rows: HistRow[],
  key: keyof HistRow,
  name: string,
  fmt: (v: number) => string,
) {
  const vals = rows.map((r) => r[key]).filter((v): v is number => typeof v === "number");
  if (vals.length < 2) return `${name}: not enough data yet.`;
  return `${name} over ${vals.length} points: from ${fmt(vals[0])} to ${fmt(vals[vals.length - 1])}, low ${fmt(Math.min(...vals))}, high ${fmt(Math.max(...vals))}.`;
}

function describePrice(rows: HistRow[], exLabel: string, otherLabel: string, overlay: boolean) {
  const base = describeSeries(rows, "mid", `${exLabel} mid price (LKR)`, (v) => formatPrice(v, 2));
  if (!overlay) return base;
  return `${base} ${describeSeries(rows, "cmp", `${otherLabel} mid price (LKR)`, (v) => formatPrice(v, 2))}`;
}
