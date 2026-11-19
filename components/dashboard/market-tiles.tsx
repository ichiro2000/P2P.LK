import { ArrowDownRight, ArrowUpRight, Star } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Sparkline } from "@/components/charts/sparkline";
import { ExchangeLink } from "@/components/dashboard/exchange-link";
import { getExchange } from "@/lib/exchanges";
import { getFiat } from "@/lib/constants";
import { formatFiat, formatPct, formatRelative } from "@/lib/format";
import type { MarketTile } from "@/lib/dashboard";
import { cn } from "@/lib/utils";

/** One card per watched market per exchange: buy/sell, spread, 24h trend. */
export function MarketTiles({ tiles }: { tiles: MarketTile[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((t) => (
        <MarketTileCard key={`${t.exchange}-${t.asset}-${t.fiat}`} tile={t} />
      ))}
    </div>
  );
}

function MarketTileCard({ tile: t }: { tile: MarketTile }) {
  const symbol = getFiat(t.fiat)?.symbol ?? t.fiat;
  const label = getExchange(t.exchange).label;
  const up = t.change24h != null && t.change24h > 0;
  const down = t.change24h != null && t.change24h < 0;
  const offline = t.buyAt == null && t.sellAt == null;
  return (
    <Card className="gap-3 px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">
            {t.asset}/{t.fiat}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {label}
            {t.ts ? ` · ${formatRelative(new Date(t.ts * 1000))}` : ""}
          </div>
        </div>
        <ExchangeLink
          exchange={t.exchange}
          href="/"
          className="-mr-2 inline-flex h-10 shrink-0 items-center rounded-md px-2 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Live book
        </ExchangeLink>
      </div>

      {offline ? (
        <p className="text-xs text-[color:var(--color-warn)]">Live book unavailable right now.</p>
      ) : (
        <dl className="grid grid-cols-2 gap-2">
          <div className="min-w-0">
            <dt className="text-[11px] text-muted-foreground">Buy USDT at</dt>
            <dd className="truncate font-mono text-lg font-semibold tabular-nums text-[color:var(--color-buy)]">
              {formatFiat(t.buyAt, symbol)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] text-muted-foreground">Sell USDT at</dt>
            <dd className="truncate font-mono text-lg font-semibold tabular-nums text-[color:var(--color-sell)]">
              {formatFiat(t.sellAt, symbol)}
            </dd>
          </div>
        </dl>
      )}

      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          Spread{" "}
          <span className="font-mono tabular-nums text-foreground">
            {formatFiat(t.spread, symbol)} ({formatPct(t.spreadPct)})
          </span>
        </span>
        {t.change24h != null && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 font-mono tabular-nums",
              up && "text-[color:var(--color-buy)]",
              down && "text-[color:var(--color-sell)]",
            )}
          >
            {up ? <ArrowUpRight className="size-3" /> : down ? <ArrowDownRight className="size-3" /> : null}
            {formatPct(t.change24h, { sign: true })}
            <span className="ml-0.5 font-sans text-muted-foreground">24h</span>
          </span>
        )}
      </div>

      {t.spark.filter((v) => v != null).length > 1 ? (
        <Sparkline values={t.spark} label={`${label} ${t.asset}/${t.fiat} mid price, 24 hours`} className="-mx-1" />
      ) : (
        <div className="flex h-8 items-center text-[11px] text-muted-foreground">No 24h history yet</div>
      )}
    </Card>
  );
}

export function StarNudge() {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
      <Star className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        Showing USDT/LKR on both exchanges. Tap the star on a market page to choose what shows here.
      </span>
    </p>
  );
}
