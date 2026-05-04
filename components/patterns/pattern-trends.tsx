"use client";

import { useMemo, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { cn } from "@/lib/utils";
import { formatFiat, formatPct, formatCompact } from "@/lib/format";
import { getFiat } from "@/lib/constants";
import { WEEKDAY_LABELS, type PatternsResult } from "@/lib/patterns-types";

type Side = "BUY" | "SELL";
type Axis = "hour" | "weekday";

export function PatternTrends({
  result,
  fiat,
}: {
  result: PatternsResult;
  fiat: string;
}) {
  const [side, setSide] = useState<Side>("SELL");
  const [axis, setAxis] = useState<Axis>("hour");
  const symbol = getFiat(fiat)?.symbol ?? fiat;

  const priceData = useMemo(() => {
    if (axis === "hour") {
      return result.hourTrend.map((h) => ({
        label: `${h.hour.toString().padStart(2, "0")}:00`,
        price: side === "BUY" ? h.avgBestBid : h.avgBestAsk,
        depth: side === "BUY" ? h.avgBidDepth : h.avgAskDepth,
        spread: h.avgSpreadPct,
      }));
    }
    // weekday — reorder Mon..Sun.
    const weekOrder = [1, 2, 3, 4, 5, 6, 0];
    return weekOrder.map((dow) => {
      const w = result.weekdayTrend[dow];
      return {
        label: WEEKDAY_LABELS[dow],
        price: side === "BUY" ? w.avgBestBid : w.avgBestAsk,
        depth: side === "BUY" ? w.avgBidDepth : w.avgAskDepth,
        spread: w.avgSpreadPct,
      };
    });
  }, [axis, side, result]);

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {axis === "hour" ? "Hour-of-day cycle" : "Weekday cycle"}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground/70">
            {side === "BUY"
              ? "Bid side — what publishers pay to buy USDT"
              : "Ask side — what publishers charge to sell USDT"}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Tabs value={axis} onValueChange={(v) => setAxis(v as Axis)}>
            <TabsList className="h-8">
              <TabsTrigger value="hour" className="px-3 text-xs">
                Hour
              </TabsTrigger>
              <TabsTrigger value="weekday" className="px-3 text-xs">
                Weekday
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <Tabs value={side} onValueChange={(v) => setSide(v as Side)}>
            <TabsList className="h-8">
              <TabsTrigger
                value="SELL"
                className={cn(
                  "px-3 text-xs",
                  "data-[state=active]:text-[color:var(--color-buy)]",
                )}
              >
                Ask (SELL)
              </TabsTrigger>
              <TabsTrigger
                value="BUY"
                className={cn(
                  "px-3 text-xs",
                  "data-[state=active]:text-[color:var(--color-sell)]",
                )}
              >
                Bid (BUY)
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className="h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={priceData} margin={{ top: 10, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.04)" />
            <XAxis
              dataKey="label"
              tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 10 }}
              axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
              tickLine={false}
            />
            <YAxis
              yAxisId="price"
              tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 10 }}
              axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
              tickLine={false}
              tickFormatter={(v) => formatFiat(v, symbol, 4)}
              width={80}
            />
            <YAxis
              yAxisId="depth"
              orientation="right"
              tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 10 }}
              axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
              tickLine={false}
              tickFormatter={(v) => formatCompact(v)}
              width={60}
            />
            <Tooltip
              contentStyle={{
                background: "rgba(15,16,20,0.95)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 8,
                fontSize: 11,
              }}
              labelStyle={{ color: "rgba(255,255,255,0.7)" }}
              formatter={(value, name) => {
                const v = typeof value === "number" ? value : Number(value);
                if (!Number.isFinite(v)) return ["—", String(name ?? "")];
                if (name === "Price") return [formatFiat(v, symbol, 4), String(name)];
                if (name === "Spread") return [formatPct(v, { frac: 2 }), String(name)];
                return [formatCompact(v), String(name ?? "")];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line
              yAxisId="price"
              type="monotone"
              dataKey="price"
              name="Price"
              stroke={side === "BUY" ? "#ef4444" : "#22c55e"}
              strokeWidth={2}
              dot={false}
            />
            <Line
              yAxisId="depth"
              type="monotone"
              dataKey="depth"
              name="Depth"
              stroke="rgba(120,140,180,0.7)"
              strokeWidth={1.5}
              strokeDasharray="3 3"
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
