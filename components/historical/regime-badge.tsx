import { Activity, MoveHorizontal } from "lucide-react";
import { formatPct, formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AsOf } from "@/components/common/as-of";
import type { Regime } from "@/lib/regime";

/** "wider than 82% of the last 7 days" / "narrower than 70% …" */
function rankWords(rank: number, more: string, less: string) {
  return rank >= 0.5
    ? `${more} than ${Math.round(rank * 100)}%`
    : `${less} than ${Math.round((1 - rank) * 100)}%`;
}

const tone = (rank: number | null) =>
  rank == null
    ? "text-muted-foreground"
    : rank >= 0.9
      ? "text-[color:var(--color-sell)]"
      : rank >= 0.75
        ? "text-[color:var(--color-warn)]"
        : rank <= 0.25
          ? "text-[color:var(--color-buy)]"
          : "text-foreground";

/**
 * Compact spread / volatility regime (D8), server-rendered. Mount on any
 * page that has a `Regime` from lib/regime `marketRegime()`:
 *   <RegimeBadge regime={await marketRegime(ex, ASSET, FIAT.code)} />
 */
export function RegimeBadge({ regime, className }: { regime: Regime; className?: string }) {
  const r = regime;
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4",
        className,
      )}
      aria-label="Spread and volatility versus the last 7 days"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <MoveHorizontal className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="text-muted-foreground">Spread</span>
        <span className="font-mono tabular-nums">{r.spreadPct != null ? formatPct(r.spreadPct, { frac: 2 }) : "—"}</span>
        <span className={cn("min-w-0", tone(r.spreadRank))}>
          {r.spreadRank != null ? `${rankWords(r.spreadRank, "wider", "narrower")} of the last 7 days` : "needs more history"}
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-1.5">
        <Activity className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="text-muted-foreground">1h volatility</span>
        <span className={cn("min-w-0", tone(r.volRank))}>
          {r.volRank != null ? `${rankWords(r.volRank, "higher", "lower")} of hours in 7 days` : "needs a day of history"}
        </span>
      </span>
      {r.move15 != null && (
        <span className="text-muted-foreground">
          Typical 15-min move{" "}
          <span className="font-mono tabular-nums text-foreground">±{formatPrice(r.move15, 2)} LKR</span>
        </span>
      )}
      <AsOf ts={r.ts} stale={r.stale} className="text-[11px] text-muted-foreground sm:ml-auto" />
    </div>
  );
}
