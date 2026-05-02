"use client";

import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MarketSnapshot } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCompact, formatFiat } from "@/lib/format";
import { getFiat } from "@/lib/constants";

type Point = { price: number; cumAsk: number; cumBid: number; side: "BID" | "ASK" };

/**
 * Cumulative depth snapshot derived from the current top-of-book ads.
 * BID side: ads sorted desc by price, cumulative available going down.
 * ASK side: ads sorted asc by price, cumulative available going up.
 *
 * Not a real Bybit depth chart (the feed doesn't include historical book),
 * but instantly useful for eyeballing where liquidity sits.
 */
export function DepthSnapshot({ market }: { market: MarketSnapshot }) {
  const fiat = getFiat(market.fiat);
  const symbol = fiat?.symbol ?? market.fiat;

  const bidAds = market.ads
    .filter((a) => a.tradeType === "BUY")
    .sort((a, b) => b.price - a.price);
  const askAds = market.ads
    .filter((a) => a.tradeType === "SELL")
    .sort((a, b) => a.price - b.price);

  const bidPoints: Point[] = [];
  let bidCum = 0;
  for (const a of bidAds) {
    bidCum += a.available;
    bidPoints.push({
      price: a.price,
      cumAsk: 0,
      cumBid: bidCum,
      side: "BID",
    });
  }

  const askPoints: Point[] = [];
  let askCum = 0;
  for (const a of askAds) {
    askCum += a.available;
    askPoints.push({
      price: a.price,
      cumAsk: askCum,
      cumBid: 0,
      side: "ASK",
    });
  }

  // Combine and sort by price to render a single chart
  const merged = [...bidPoints, ...askPoints].sort(
    (a, b) => a.price - b.price,
  );

  if (merged.length === 0) {
    return (
      <Card className="card-lift border-border bg-card/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Market depth
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[160px] items-center justify-center text-xs text-muted-foreground">
            No ads in this market
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="card-lift border-border bg-card/60">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Market depth
          </CardTitle>
          <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--color-sell)]" />
              BUY ADS
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--color-buy)]" />
              SELL ADS
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[180px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={merged}
              margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
            >
              <defs>
                {/* BID (publisher's BUY ads) = retail sell context → red.
                    ASK (publisher's SELL ads) = retail buy context → green. */}
                <linearGradient id="bidFill" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="var(--color-sell)"
                    stopOpacity={0.45}
                  />
                  <stop
                    offset="100%"
                    stopColor="var(--color-sell)"
                    stopOpacity={0}
                  />
                </linearGradient>
                <linearGradient id="askFill" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="var(--color-buy)"
                    stopOpacity={0.45}
                  />
                  <stop
                    offset="100%"
                    stopColor="var(--color-buy)"
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="price"
                type="number"
                domain={["dataMin", "dataMax"]}
                tick={{
                  fill: "var(--color-muted-foreground)",
                  fontSize: 10,
                  fontFamily: "var(--font-mono)",
                }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => (Math.round(Number(v) * 100) / 100).toString()}
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
                cursor={{
                  stroke: "var(--color-border)",
                  strokeWidth: 1,
                }}
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
                itemStyle={{
                  fontFamily: "var(--font-mono)",
                }}
                labelFormatter={(v) => `Price: ${formatFiat(Number(v), symbol, 2)}`}
                formatter={(val, name) => {
                  const n = Number(val);
                  if (!Number.isFinite(n) || n === 0) return ["—", name as string];
                  return [`${formatCompact(n)} ${market.asset}`, name as string];
                }}
              />
              <Area
                type="stepAfter"
                dataKey="cumBid"
                name="Buy Ads"
                stroke="var(--color-sell)"
                fill="url(#bidFill)"
                strokeWidth={1.5}
                isAnimationActive={false}
              />
              <Area
                type="stepBefore"
                dataKey="cumAsk"
                name="Sell Ads"
                stroke="var(--color-buy)"
                fill="url(#askFill)"
                strokeWidth={1.5}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
