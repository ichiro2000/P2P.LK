"use client";

import { Star } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useFavouriteMerchants, useWatchlist } from "@/hooks/use-member-data";
import { useExchange } from "@/components/shell/exchange-context";
import type { ExchangeId } from "@/lib/exchanges/types";

/**
 * Toggles a market or merchant in/out of the user's workspace lists.
 * Tiny UI footprint — a button that fills the star when active.
 * Fires a subtle toast on toggle so the user knows it stuck. Members' lists
 * sync to their account; guests' stay in this browser (useWatchlist etc).
 */
export function MarketStar({
  asset,
  fiat,
  size = "sm",
  className,
}: {
  asset: string;
  fiat: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const watchlist = useWatchlist();
  const active = watchlist.has(asset, fiat);

  function onClick(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (watchlist.mode === "loading") return;
    const nowActive = watchlist.toggle(asset, fiat);
    toast(
      nowActive
        ? `${asset}/${fiat} added to watchlist`
        : `${asset}/${fiat} removed from watchlist`,
      { duration: 1600 },
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={
        active
          ? `Remove ${asset}/${fiat} from watchlist`
          : `Add ${asset}/${fiat} to watchlist`
      }
      className={cn(
        "inline-flex items-center justify-center rounded-md border border-border bg-card/50 text-muted-foreground transition-all",
        "hover:bg-muted hover:text-foreground",
        size === "sm" ? "h-7 w-7" : "h-8 w-8",
        active &&
          "border-[color:var(--color-warn)]/40 bg-[color:var(--color-warn)]/10 text-[color:var(--color-warn)]",
        className,
      )}
    >
      <Star
        className={cn(size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4")}
        fill={active ? "currentColor" : "none"}
        strokeWidth={1.75}
      />
    </button>
  );
}

export function MerchantStar({
  id,
  name,
  asset,
  fiat,
  exchange,
  className,
}: {
  id: string;
  name: string;
  asset?: string;
  fiat?: string;
  /** Defaults to the active exchange. */
  exchange?: ExchangeId;
  className?: string;
}) {
  const activeExchange = useExchange().exchange;
  const ex = exchange ?? activeExchange;
  const favourites = useFavouriteMerchants();
  const active = favourites.has(ex, id);

  function onClick(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (favourites.mode === "loading") return;
    const nowActive = favourites.toggle({ exchange: ex, id, name, asset, fiat });
    toast(
      nowActive
        ? `${name} saved to merchants`
        : `${name} removed from merchants`,
      { duration: 1600 },
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={active ? `Unfavourite ${name}` : `Favourite ${name}`}
      className={cn(
        "inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-all",
        "hover:bg-muted hover:text-foreground",
        active &&
          "bg-[color:var(--color-warn)]/15 text-[color:var(--color-warn)]",
        className,
      )}
    >
      <Star
        className="h-3 w-3"
        fill={active ? "currentColor" : "none"}
        strokeWidth={1.75}
      />
    </button>
  );
}
