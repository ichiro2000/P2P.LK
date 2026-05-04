"use client";

import { useMemo, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { formatFiat, formatPct, formatCompact } from "@/lib/format";
import { getFiat } from "@/lib/constants";
import {
  WEEKDAY_LABELS,
  type PatternCell,
  type PatternsResult,
} from "@/lib/patterns-types";

type Metric =
  | "bidDepth"
  | "askDepth"
  | "spread"
  | "bestBid"
  | "bestAsk"
  | "midPrice";

type Side = "BUY" | "SELL" | "BOTH";

const METRIC_LABELS: Record<Metric, string> = {
  bidDepth: "Bid depth",
  askDepth: "Ask depth",
  spread: "Spread %",
  bestBid: "Best bid",
  bestAsk: "Best ask",
  midPrice: "Mid price",
};

export function PatternHeatmap({
  result,
  fiat,
}: {
  result: PatternsResult;
  fiat: string;
}) {
  const [side, setSide] = useState<Side>("BOTH");
  const [metric, setMetric] = useState<Metric>(
    side === "BUY" ? "bidDepth" : side === "SELL" ? "askDepth" : "spread",
  );

  const symbol = getFiat(fiat)?.symbol ?? fiat;

  // When the user flips Buy/Sell, surface the most relevant metric for that
  // side automatically. They can still override.
  function onSideChange(next: Side) {
    setSide(next);
    if (next === "BUY") setMetric("bidDepth");
    else if (next === "SELL") setMetric("askDepth");
    else setMetric("spread");
  }

  const availableMetrics: Metric[] = useMemo(() => {
    if (side === "BUY") return ["bestBid", "bidDepth"];
    if (side === "SELL") return ["bestAsk", "askDepth"];
    return ["spread", "midPrice", "bidDepth", "askDepth"];
  }, [side]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={side} onValueChange={(v) => onSideChange(v as Side)}>
          <TabsList className="h-9">
            <TabsTrigger
              value="BUY"
              className="data-[state=active]:text-[color:var(--color-sell)] px-4 text-xs"
            >
              Bid side (BUY)
            </TabsTrigger>
            <TabsTrigger
              value="SELL"
              className="data-[state=active]:text-[color:var(--color-buy)] px-4 text-xs"
            >
              Ask side (SELL)
            </TabsTrigger>
            <TabsTrigger value="BOTH" className="px-4 text-xs">
              Both
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex flex-wrap gap-1.5">
          {availableMetrics.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMetric(m)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors",
                metric === m
                  ? "border-primary/60 bg-primary/10 text-foreground"
                  : "border-border bg-card/40 text-muted-foreground hover:border-primary/40 hover:text-foreground",
              )}
            >
              {METRIC_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      <Heatmap result={result} metric={metric} symbol={symbol} />

      <div className="text-[11px] text-muted-foreground">
        Bucketing in Asia/Colombo. {result.grid.totalSamples.toLocaleString()}{" "}
        snapshots over the last {result.grid.range}.
      </div>
    </div>
  );
}

function colorFor(value: number, max: number, kind: "depth" | "spread"): string {
  if (max <= 0 || !Number.isFinite(value) || value <= 0) {
    return "rgb(31 33 38)"; // base muted
  }
  const t = Math.min(1, value / max);
  if (kind === "spread") {
    // Higher spread = warmer (warning amber)
    const r = Math.round(40 + 215 * t);
    const g = Math.round(60 + 90 * t);
    const b = Math.round(40 + 0 * t);
    return `rgb(${r} ${g} ${b})`;
  }
  // Depth: darker → lighter primary green
  const r = Math.round(28 + 26 * t);
  const g = Math.round(40 + 175 * t);
  const b = Math.round(38 + 90 * t);
  return `rgb(${r} ${g} ${b})`;
}

function readMetric(c: PatternCell, metric: Metric): number | null {
  switch (metric) {
    case "bidDepth":
      return c.avgBidDepth;
    case "askDepth":
      return c.avgAskDepth;
    case "spread":
      return c.avgSpreadPct;
    case "bestBid":
      return c.avgBestBid;
    case "bestAsk":
      return c.avgBestAsk;
    case "midPrice":
      return c.avgMid;
  }
}

function Heatmap({
  result,
  metric,
  symbol,
}: {
  result: PatternsResult;
  metric: Metric;
  symbol: string;
}) {
  const max = useMemo(() => {
    let m = 0;
    for (const c of result.grid.cells) {
      const v = readMetric(c, metric);
      if (v != null && v > m) m = v;
    }
    return m;
  }, [result.grid.cells, metric]);

  const isPrice = metric === "bestBid" || metric === "bestAsk" || metric === "midPrice";
  const isSpread = metric === "spread";
  const colorKind = isSpread ? "spread" : "depth";

  // Reorder weekdays so Mon → Sun reads naturally (working week first).
  const weekOrder = [1, 2, 3, 4, 5, 6, 0];

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card/60 p-3">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-[40px_repeat(24,minmax(20px,1fr))] gap-0.5 text-[9px] text-muted-foreground/70">
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="text-center">
              {h % 3 === 0 ? `${h.toString().padStart(2, "0")}` : ""}
            </div>
          ))}
        </div>

        {weekOrder.map((dow) => {
          const cells = result.grid.cells.filter((c) => c.dow === dow);
          return (
            <div
              key={dow}
              className="mt-0.5 grid grid-cols-[40px_repeat(24,minmax(20px,1fr))] gap-0.5"
            >
              <div className="flex items-center text-[10px] font-mono text-muted-foreground">
                {WEEKDAY_LABELS[dow]}
              </div>
              {cells.map((c) => {
                const v = readMetric(c, metric);
                const display =
                  v == null
                    ? "—"
                    : isPrice
                      ? formatFiat(v, symbol, 4)
                      : isSpread
                        ? formatPct(v, { frac: 2 })
                        : formatCompact(v);
                const bg =
                  v == null
                    ? "rgb(20 22 26)"
                    : isPrice
                      ? colorFor(
                          v - (max - (max - v)),
                          max,
                          "depth",
                        )
                      : colorFor(v, max, colorKind);
                return (
                  <div
                    key={`${c.dow}-${c.hour}`}
                    title={`${WEEKDAY_LABELS[c.dow]} ${c.hour}:00 — ${display} (${c.samples} samples)`}
                    className="h-7 rounded-[2px] transition-transform hover:scale-110"
                    style={{ backgroundColor: bg }}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
