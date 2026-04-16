"use client";

import { Star } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  favouriteMerchants,
  useStorageValue,
  watchlistMarkets,
  STORAGE_KEYS,
} from "@/lib/storage";

/**
 * Toggles a market or merchant in/out of the user's workspace lists.
 * Tiny UI footprint — a button that fills the star when active.
 * Fires a subtle toast on toggle so the user knows it stuck.
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
  const active = useStorageValue(
    () => watchlistMarkets.has(asset, fiat),
    [STORAGE_KEYS.markets],
    false,
  );

  function onClick(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    const nowActive = watchlistMarkets.toggle(asset, fiat);
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
        "hover:border-primary/40 hover:text-foreground",
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
  className,
}: {
  id: string;
  name: string;
  asset?: string;
  fiat?: string;
  className?: string;
}) {
  const active = useStorageValue(
    () => favouriteMerchants.has(id),
    [STORAGE_KEYS.merchants],
    false,
  );

  function onClick(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    const nowActive = favouriteMerchants.toggle({ id, name, asset, fiat });
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
