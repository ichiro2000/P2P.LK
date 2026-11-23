"use client";

import { useEffect, useRef, useState } from "react";
import { Bitcoin } from "lucide-react";
import type { MarketSnapshot } from "@/lib/types";
import { btcInLkr, type BtcSpot } from "@/lib/btc";
import { usePolling } from "@/hooks/use-polling";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { FIAT } from "@/lib/constants";
import { formatFiat, formatPct, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MarketHistoryPoint } from "./market-kpis";

/** USDT/LKR mid ~24 h ago, from the oldest history point with both sides. */
function usdtMid24hAgo(history: MarketHistoryPoint[]): number | null {
  const p = history.find((h) => h.bid != null && h.ask != null);
  return p ? (p.bid! + p.ask!) / 2 : null;
}

function Pct({ v, className }: { v: number | null; className?: string }) {
  if (v == null || !Number.isFinite(v)) return <span className={className}>—</span>;
  return (
    <span
      className={cn(
        "font-mono tabular-nums",
        v > 0 && "text-[color:var(--color-buy)]",
        v < 0 && "text-[color:var(--color-sell)]",
        className,
      )}
    >
      {formatPct(v, { frac: 2, sign: true })}
    </span>
  );
}

/**
 * Bitcoin priced in LKR through this P2P book: BTC/USDT spot × the live
 * USDT/LKR price. Both legs re-poll every 20 s, so the LKR figure moves when
 * either Bitcoin or the USDT rate moves, and the card says which one did.
 */
export function BtcLkr({ market, history }: { market: MarketSnapshot; history: MarketHistoryPoint[] }) {
  const { data: spot, error } = usePolling<BtcSpot>("/api/p2p/btc", { intervalMs: 20_000 });
  const [unit, setUnit] = useState<"USDT" | "LKR">("USDT");
  const sym = FIAT.symbol;
  const mid = market.mid;
  const ask = market.sell.bestPrice; // what you pay per USDT
  const bid = market.buy.bestPrice; // what you get per USDT

  // What drove the last change in the LKR price: BTC, USDT, or both.
  const prev = useRef<{ btc: number; usdt: number; lkr: number } | null>(null);
  const [move, setMove] = useState<{ lkr: number; btc: number; usdt: number } | null>(null);
  useEffect(() => {
    if (!spot || mid == null) return;
    const cur = { btc: spot.price, usdt: mid, lkr: spot.price * mid };
    const p = prev.current;
    if (p && (p.btc !== cur.btc || p.usdt !== cur.usdt)) {
      setMove({ lkr: cur.lkr / p.lkr - 1, btc: cur.btc / p.btc - 1, usdt: cur.usdt / p.usdt - 1 });
    }
    prev.current = cur;
  }, [spot, mid]);

  if (!spot) {
    return (
      <Card className="flex-row items-center gap-3 px-4 py-3.5 text-xs text-muted-foreground">
        <Bitcoin className="size-4" />
        {error ? "Bitcoin price unavailable right now." : "Loading Bitcoin price…"}
      </Card>
    );
  }

  const { lkr, usdtChange, lkrChange } = btcInLkr(spot, mid, usdtMid24hAgo(history));
  // 24 h change in USDT: now minus the price 24 h ago (price / (1 + change)).
  const usdtDelta =
    spot.change24h != null && spot.change24h > -1 ? spot.price - spot.price / (1 + spot.change24h) : null;
  const buyLkr = ask != null ? spot.price * ask : null;
  const sellLkr = bid != null ? spot.price * bid : null;

  return (
    <Card className="gap-3 px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Bitcoin className="size-4 text-[#f7931a]" />
          {unit === "USDT" ? `Bitcoin in USDT · ${spot.source} spot` : "Bitcoin in LKR · via USDT P2P"}
        </span>
        <span className="flex items-center gap-2">
          {unit === "LKR" && (
            <span className="hidden text-[11px] text-muted-foreground md:inline">
              BTC/USDT {formatPrice(spot.price, 2)} × USDT/LKR {formatFiat(mid, sym, 2)}
            </span>
          )}
          <ToggleGroup
            value={[unit]}
            onValueChange={(v) => v[0] && setUnit(v[0] as "USDT" | "LKR")}
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="Show Bitcoin in"
          >
            <ToggleGroupItem value="USDT" className="px-2.5 text-xs">
              USDT
            </ToggleGroupItem>
            <ToggleGroupItem value="LKR" className="px-2.5 text-xs">
              LKR
            </ToggleGroupItem>
          </ToggleGroup>
        </span>
      </div>

      {unit === "USDT" ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="col-span-2 min-w-0 sm:col-span-1">
            <div className="text-[11px] text-muted-foreground">1 BTC</div>
            <div
              key={spot.price}
              className="animate-in fade-in font-mono text-xl font-semibold leading-tight tabular-nums duration-500 sm:text-2xl"
            >
              {formatPrice(spot.price, 2)} <span className="text-sm font-normal text-muted-foreground">USDT</span>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              <Pct v={spot.change24h} /> 24h
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-[11px] text-muted-foreground">24h change</div>
            <div
              className={cn(
                "font-mono text-lg font-semibold tabular-nums",
                usdtDelta != null && usdtDelta > 0 && "text-[color:var(--color-buy)]",
                usdtDelta != null && usdtDelta < 0 && "text-[color:var(--color-sell)]",
              )}
            >
              {usdtDelta == null
                ? "—"
                : `${usdtDelta > 0 ? "+" : usdtDelta < 0 ? "−" : ""}${formatPrice(Math.abs(usdtDelta), 2)} USDT`}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              from {usdtDelta == null ? "—" : formatPrice(spot.price - usdtDelta, 2)} USDT
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-[11px] text-muted-foreground">24h high</div>
            <div className="font-mono text-lg font-semibold tabular-nums">
              {spot.high24h == null ? "—" : `${formatPrice(spot.high24h, 2)} USDT`}
            </div>
          </div>
          <div className="min-w-0">
            <div className="text-[11px] text-muted-foreground">24h low</div>
            <div className="font-mono text-lg font-semibold tabular-nums">
              {spot.low24h == null ? "—" : `${formatPrice(spot.low24h, 2)} USDT`}
            </div>
          </div>
        </div>
      ) : (

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="min-w-0">
          <div className="text-[11px] text-muted-foreground">1 BTC in LKR (mid)</div>
          <div
            key={lkr ?? 0}
            className="animate-in fade-in font-mono text-xl font-semibold leading-tight tabular-nums duration-500 sm:text-2xl"
          >
            {formatFiat(lkr, sym, 0)}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
            <Pct v={lkrChange} /> 24h in LKR
            <span>=</span> BTC <Pct v={spot.change24h} />
            <span>·</span> USDT <Pct v={usdtChange} />
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-[11px] text-muted-foreground">Buy 1 BTC (USDT at best ask)</div>
          <div className="font-mono text-lg font-semibold tabular-nums text-[color:var(--color-buy)]">
            {formatFiat(buyLkr, sym, 0)}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-[11px] text-muted-foreground">Sell 1 BTC (USDT at best bid)</div>
          <div className="font-mono text-lg font-semibold tabular-nums text-[color:var(--color-sell)]">
            {formatFiat(sellLkr, sym, 0)}
          </div>
        </div>
      </div>
      )}

      <div className="text-[11px] text-muted-foreground" aria-live="polite">
        {unit === "USDT" ? (
          "Last traded BTC/USDT spot price, updated every 20 s. Switch to LKR to see it through the USDT/LKR P2P rate."
        ) : move ? (
          <>
            Last move <Pct v={move.lkr} /> in LKR: BTC <Pct v={move.btc} />, USDT/LKR <Pct v={move.usdt} />
            {Math.abs(move.usdt) > Math.abs(move.btc) ? " (driven by the USDT rate)" : " (driven by Bitcoin)"}.
          </>
        ) : (
          "Moves with both Bitcoin and the USDT/LKR rate. Spot fees and P2P limits not included."
        )}
      </div>
    </Card>
  );
}
