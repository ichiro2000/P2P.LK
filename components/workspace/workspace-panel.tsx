"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty } from "@/components/common/empty";
import { WatchlistMarketCard } from "./market-card";
import {
  favouriteMerchants,
  recent,
  savedFilters,
  useStorageValue,
  watchlistMarkets,
  STORAGE_KEYS,
} from "@/lib/storage";
import { Bookmark, Clock, History, Pin, Star, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * The whole workspace lives in localStorage. This panel renders reactively
 * via useStorageValue — so adding/removing anywhere in the app updates here
 * without a reload.
 */
export function WorkspacePanel() {
  const markets = useStorageValue(
    () => watchlistMarkets.list(),
    [STORAGE_KEYS.markets],
    [],
  );
  const merchants = useStorageValue(
    () => favouriteMerchants.list(),
    [STORAGE_KEYS.merchants],
    [],
  );
  const filters = useStorageValue(
    () => savedFilters.list(),
    [STORAGE_KEYS.filters],
    [],
  );
  const visits = useStorageValue(
    () => recent.list(),
    [STORAGE_KEYS.recent],
    [],
  );

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_340px]">
      <div className="space-y-5">
        <Section
          title="Watchlisted markets"
          icon={Pin}
          description="Live prices for the markets you care about. Polled every 30s."
          count={markets.length}
        >
          {markets.length === 0 ? (
            <Empty
              icon={Pin}
              title="No markets saved yet"
              description="Star any market from the Live Markets, Historical, Risk or Liquidity header to add it here."
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {markets.map((m) => (
                <WatchlistMarketCard
                  key={`${m.asset}/${m.fiat}`}
                  ref={m}
                />
              ))}
            </div>
          )}
        </Section>

        <Section
          title="Favourite merchants"
          icon={Star}
          description="Counterparties you've starred from the Merchants table."
          count={merchants.length}
        >
          {merchants.length === 0 ? (
            <Empty
              icon={Star}
              title="No merchants saved yet"
              description="Star a row in /merchants to track reliable counterparties."
            />
          ) : (
            <div className="rounded-lg border border-border bg-card/60 overflow-hidden">
              {merchants.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3 last:border-0 transition-colors hover:bg-accent/40"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted/50 font-mono text-[11px] font-medium text-muted-foreground">
                      {(m.name || "?").slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">
                        {m.name}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {m.asset && m.fiat ? (
                          <>
                            Seen on{" "}
                            <Link
                              href={`/merchants?asset=${m.asset}&fiat=${m.fiat}`}
                              className="font-mono text-foreground/80 hover:text-foreground"
                            >
                              {m.asset}/{m.fiat}
                            </Link>
                          </>
                        ) : (
                          "Saved counterparty"
                        )}
                        {" · added "}
                        {formatDistanceToNow(new Date(m.addedAt), {
                          addSuffix: true,
                        })}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="rounded-md border border-border bg-card/60 px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:border-[color:var(--color-sell)]/40 hover:text-[color:var(--color-sell)]"
                    onClick={() => {
                      favouriteMerchants.remove(m.id);
                      toast(`${m.name} removed`);
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      <div className="space-y-5">
        <Section
          title="Saved filters"
          icon={Bookmark}
          description="One-click jumps back to a configured view."
          count={filters.length}
        >
          {filters.length === 0 ? (
            <Empty
              icon={Bookmark}
              title="No filters saved"
              description='Hit "Save filter" next to any filter bar to pin it here.'
            />
          ) : (
            <div className="rounded-lg border border-border bg-card/60 overflow-hidden">
              {filters.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2.5 last:border-0 transition-colors hover:bg-accent/40"
                >
                  <Link
                    href={`${f.path}${f.search ? `?${f.search}` : ""}`}
                    className="min-w-0 flex-1"
                  >
                    <div className="truncate text-sm font-medium text-foreground group-hover:text-foreground">
                      {f.label}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                      {f.path}
                      {f.search ? `?${f.search}` : ""}
                    </div>
                  </Link>
                  <button
                    type="button"
                    className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    onClick={(e) => {
                      e.preventDefault();
                      savedFilters.remove(f.id);
                    }}
                    aria-label={`Remove ${f.label}`}
                  >
                    <X className="h-3 w-3" strokeWidth={2} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section
          title="Recently viewed"
          icon={History}
          description="Your last 8 pages across the app."
          count={visits.length}
          action={
            visits.length > 0 ? (
              <button
                type="button"
                onClick={() => recent.clear()}
                className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            ) : null
          }
        >
          {visits.length === 0 ? (
            <Empty
              icon={Clock}
              title="Nothing to show yet"
              description="Browse the app — every page you open is tracked here."
            />
          ) : (
            <div className="rounded-lg border border-border bg-card/60 overflow-hidden">
              {visits.map((v, i) => (
                <Link
                  key={`${v.path}-${v.at}`}
                  href={`${v.path}${v.search ? `?${v.search}` : ""}`}
                  className={cn(
                    "flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2.5 last:border-0 transition-colors hover:bg-accent/40",
                  )}
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-foreground">
                      {v.title}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                      {v.path}
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/70">
                    {formatDistanceToNow(new Date(v.at), {
                      addSuffix: false,
                    })}
                    {i === 0 ? "" : " ago"}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  description,
  icon: Icon,
  count,
  action,
  children,
}: {
  title: string;
  description: string;
  icon: typeof Pin;
  count: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-border bg-transparent">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-[13px] font-semibold">
            <Icon
              className="h-3.5 w-3.5 text-primary"
              strokeWidth={1.75}
            />
            {title}
            {count > 0 && (
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                {count}
              </span>
            )}
          </CardTitle>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {description}
          </p>
        </div>
        {action}
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  );
}
