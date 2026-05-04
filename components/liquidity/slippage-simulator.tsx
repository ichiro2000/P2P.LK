"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  formatCompact,
  formatFiat,
  formatPct,
  formatPrice,
} from "@/lib/format";
import { getFiat } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { SlippageResult } from "@/lib/liquidity";
import { ShieldCheck, TriangleAlert } from "lucide-react";

type Side = "SELL" | "BUY";

/**
 * Walks the live book for a user-supplied fiat amount, showing the effective
 * price, slippage, and which merchants (and how many) you'd transact with.
 *
 * Runs against /api/liquidity/slippage; debounced 250ms on input change.
 */
export function SlippageSimulator({
  asset,
  fiat,
  defaultAmount = 500_000,
}: {
  asset: string;
  fiat: string;
  defaultAmount?: number;
}) {
  const [side, setSide] = useState<Side>("SELL");
  const [amount, setAmount] = useState<number>(defaultAmount);
  const [result, setResult] = useState<SlippageResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const symbol = getFiat(fiat)?.symbol ?? fiat;

  const runSim = useCallback(
    async (next: { side: Side; amount: number }) => {
      if (!Number.isFinite(next.amount) || next.amount <= 0) {
        setResult(null);
        setError(null);
        return;
      }
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(true);
      try {
        const res = await fetch(
          `/api/liquidity/slippage?asset=${asset}&fiat=${fiat}&side=${next.side}&amount=${next.amount}`,
          { signal: ac.signal },
        );
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const json = (await res.json()) as SlippageResult;
        setResult(json);
        setError(null);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [asset, fiat],
  );

  // Debounce on amount change
  useEffect(() => {
    const id = setTimeout(() => runSim({ side, amount }), 250);
    return () => clearTimeout(id);
  }, [side, amount, runSim]);

  const shortfall = result?.shortfall ?? 0;
  const filled = result?.filledFiat ?? 0;
  const fillPct = amount > 0 ? filled / amount : 0;
  const isThin = shortfall > 0;

  return (
    <Card className="card-lift border-border bg-card/60">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Slippage simulator
          </CardTitle>
          <Tabs value={side} onValueChange={(v) => setSide(v as Side)}>
            <TabsList className="h-8">
              <TabsTrigger value="SELL" className="px-3 text-xs">
                Buying {asset}
              </TabsTrigger>
              <TabsTrigger value="BUY" className="px-3 text-xs">
                Selling {asset}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Target amount ({fiat})
            </Label>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm text-muted-foreground">
                {symbol}
              </span>
              <Input
                type="number"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value) || 0)}
                className="w-[180px] font-mono tabular-nums"
                min={0}
                step={10_000}
                aria-label="Target amount"
              />
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            {[100_000, 500_000, 1_000_000, 5_000_000].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setAmount(preset)}
                className={cn(
                  "rounded-md border px-2.5 py-1 font-mono text-[11px] tabular-nums transition-colors",
                  amount === preset
                    ? "border-primary/40 bg-primary/10 text-foreground"
                    : "border-border bg-card/50 text-muted-foreground hover:border-primary/30 hover:text-foreground",
                )}
              >
                {symbol} {formatCompact(preset)}
              </button>
            ))}
          </div>
        </div>

        <div className="h-2 overflow-hidden rounded-full bg-muted/50">
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-500 ease-out",
              isThin
                ? "bg-[color:var(--color-warn)]"
                : "bg-[color:var(--color-buy)]",
            )}
            style={{
              width: `${Math.max(2, Math.min(100, fillPct * 100))}%`,
            }}
          />
        </div>

        {error && (
          <div className="rounded-md border border-[color:var(--color-sell)]/30 bg-[color:var(--color-sell)]/10 px-3 py-2 text-[12px] text-[color:var(--color-sell)]">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-4">
          <ResultStat
            label="Top price"
            value={
              result?.topPrice != null ? formatFiat(result.topPrice, symbol, 4) : "—"
            }
          />
          <ResultStat
            label="Effective price"
            value={
              result?.effectivePrice != null
                ? formatFiat(result.effectivePrice, symbol, 4)
                : "—"
            }
          />
          <ResultStat
            label="Slippage"
            value={
              result?.slippagePct != null
                ? formatPct(result.slippagePct, { frac: 3, sign: true })
                : "—"
            }
            tone={
              result?.slippagePct != null && result.slippagePct > 0.002
                ? "warn"
                : "neutral"
            }
          />
          <ResultStat
            label="Asset filled"
            value={
              result?.filledAsset != null
                ? `${formatCompact(result.filledAsset)} ${asset}`
                : "—"
            }
            footnote={`${formatFiat(filled, symbol, 0)} of ${formatFiat(amount, symbol, 0)}`}
          />
        </div>

        {result && (
          <div className="rounded-md border border-border/60 bg-card/40 p-3">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <div className="flex items-center gap-1.5">
                {isThin ? (
                  <>
                    <TriangleAlert
                      className="h-3.5 w-3.5 text-[color:var(--color-warn)]"
                      strokeWidth={1.75}
                    />
                    <span>
                      Book doesn&apos;t have depth for the full size — short by{" "}
                      <span className="font-mono tabular-nums text-foreground">
                        {formatFiat(shortfall, symbol, 0)}
                      </span>
                      .
                    </span>
                  </>
                ) : (
                  <>
                    <ShieldCheck
                      className="h-3.5 w-3.5 text-[color:var(--color-buy)]"
                      strokeWidth={1.75}
                    />
                    <span>Fills in full across the current book.</span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-3 font-mono tabular-nums">
                <span>{result.adsConsumed} ads</span>
                <span>
                  {result.merchantsConsumed} merchant
                  {result.merchantsConsumed === 1 ? "" : "s"}
                </span>
                {loading && (
                  <Badge
                    variant="outline"
                    className="h-4 border-dashed text-[9px] text-muted-foreground"
                  >
                    recomputing
                  </Badge>
                )}
              </div>
            </div>
          </div>
        )}

        {result && result.steps.length > 0 && (
          <StepList
            steps={result.steps}
            symbol={symbol}
            asset={asset}
            topPrice={result.topPrice}
            side={side}
          />
        )}
      </CardContent>
    </Card>
  );
}

function ResultStat({
  label,
  value,
  tone = "neutral",
  footnote,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "warn";
  footnote?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-lg font-semibold tabular-nums leading-none",
          tone === "warn"
            ? "text-[color:var(--color-warn)]"
            : "text-foreground",
        )}
      >
        {value}
      </span>
      {footnote && (
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground/70">
          {footnote}
        </span>
      )}
    </div>
  );
}

function StepList({
  steps,
  symbol,
  asset,
  topPrice,
  side,
}: {
  steps: NonNullable<SlippageResult["steps"]>;
  symbol: string;
  asset: string;
  topPrice: number | null;
  side: Side;
}) {
  const visible = steps.slice(0, 8);
  return (
    <div className="space-y-1.5">
      <div className="px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Fill path
      </div>
      <div className="overflow-hidden rounded-md border border-border/60">
        {visible.map((s, i) => {
          const dev =
            topPrice != null && topPrice > 0
              ? side === "SELL"
                ? (s.price - topPrice) / topPrice
                : (topPrice - s.price) / topPrice
              : null;
          return (
            <div
              key={s.adId}
              className={cn(
                "grid grid-cols-[24px_minmax(0,1fr)_auto_auto_auto] items-center gap-3 border-b border-border/60 px-3 py-2 text-[12px] last:border-0",
                i % 2 === 0 ? "bg-card/30" : "bg-transparent",
              )}
            >
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                #{i + 1}
              </span>
              <span className="truncate font-medium text-foreground">
                {s.merchantName}
              </span>
              <span className="font-mono tabular-nums text-foreground/80">
                {formatPrice(s.price, 4)} {symbol}
              </span>
              <span className="font-mono tabular-nums text-muted-foreground">
                {formatCompact(s.assetFilled)} {asset}
              </span>
              <span
                className={cn(
                  "font-mono tabular-nums w-14 text-right",
                  dev != null && dev > 0.002
                    ? "text-[color:var(--color-warn)]"
                    : "text-muted-foreground",
                )}
              >
                {dev != null ? formatPct(dev, { frac: 2, sign: true }) : "—"}
              </span>
            </div>
          );
        })}
        {steps.length > visible.length && (
          <div className="px-3 py-2 text-[11px] text-muted-foreground">
            + {steps.length - visible.length} more step
            {steps.length - visible.length === 1 ? "" : "s"}
          </div>
        )}
      </div>
    </div>
  );
}
