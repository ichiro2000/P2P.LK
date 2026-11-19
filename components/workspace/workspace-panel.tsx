"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { Ban, Bookmark, ChevronRight, Clock, Lock, Pin, Star, X } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { KpiGrid, PageSection } from "@/components/common/page";
import { KpiCard } from "@/components/common/kpi-card";
import { Empty } from "@/components/common/empty";
import { WatchlistMarketCard } from "./market-card";
import { recent, useStorageValue, STORAGE_KEYS, type RecentVisit } from "@/lib/storage";
import { useBlocklist, useFavouriteMerchants, useSavedFilters, useWatchlist } from "@/hooks/use-member-data";
import { EXCHANGES } from "@/lib/exchanges";

const NO_VISITS: RecentVisit[] = [];

/**
 * The workspace renders reactively from the member data layer: guests read
 * this browser's storage, members their synced account. Starring anywhere in
 * the app updates it without a reload. "Recently viewed" always stays local.
 */
export function WorkspacePanel() {
  const watchlist = useWatchlist();
  const favourites = useFavouriteMerchants();
  const saved = useSavedFilters();
  const blocklist = useBlocklist();
  const markets = watchlist.items;
  const merchants = favourites.items;
  const filters = saved.items;
  const visits = useStorageValue(() => recent.list(), [STORAGE_KEYS.recent], NO_VISITS);

  return (
    <div className="space-y-6 lg:space-y-8">
      <KpiGrid>
        <KpiCard label="Markets" value={markets.length} sub="on your watchlist" />
        <KpiCard label="Merchants" value={merchants.length} sub="starred" />
        <KpiCard label="Saved filters" value={filters.length} sub="one-tap views" />
        <KpiCard label="Recent pages" value={visits.length} sub="last 8 visits" />
      </KpiGrid>

      <div className="grid grid-cols-1 gap-6 lg:gap-8 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-6 lg:space-y-8">
          <PageSection title="Watchlist" description="Live prices for markets you starred, refreshed every 30 seconds.">
            {markets.length === 0 ? (
              <Empty
                icon={Pin}
                title="No markets saved yet"
                description="Star a market from the Markets, Historical, Risk or Liquidity header to add it here."
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {markets.map((m) => (
                  <WatchlistMarketCard key={m.key} market={m} />
                ))}
              </div>
            )}
          </PageSection>

          <PageSection title="Favourite merchants" description="Counterparties you starred in the Merchants table.">
            {merchants.length === 0 ? (
              <Empty
                icon={Star}
                title="No merchants saved yet"
                description="Star a row on the Merchants page to keep track of reliable counterparties."
              />
            ) : (
              <Card className="gap-0 py-0">
                <ul className="divide-y">
                  {merchants.map((m) => (
                    <li key={m.key} className="flex items-center gap-3 px-4 py-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs font-medium text-muted-foreground">
                        {(m.name || "?").slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/merchants/${encodeURIComponent(m.id)}`}
                          className="block truncate text-sm font-medium underline-offset-2 hover:underline"
                        >
                          {m.name}
                        </Link>
                        <div className="truncate text-xs text-muted-foreground">
                          {m.exchange ? `${EXCHANGES[m.exchange].label} · ` : null}
                          {m.asset && m.fiat ? (
                            <>
                              Seen on{" "}
                              <Link
                                href={`/merchants?asset=${m.asset}&fiat=${m.fiat}`}
                                className="font-mono text-foreground underline-offset-2 hover:underline"
                              >
                                {m.asset}/{m.fiat}
                              </Link>
                            </>
                          ) : (
                            "Saved counterparty"
                          )}
                          {" · added "}
                          {formatDistanceToNow(new Date(m.addedAt), { addSuffix: true })}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-10 shrink-0 text-muted-foreground hover:text-[color:var(--color-sell)]"
                        aria-label={`Remove ${m.name}`}
                        onClick={() => {
                          favourites.remove(m);
                          toast(`${m.name} removed`);
                        }}
                      >
                        <X />
                      </Button>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </PageSection>

          <BlockedMerchants blocklist={blocklist} />
        </div>

        <div className="min-w-0 space-y-6 lg:space-y-8">
          <PageSection title="Saved filters" description="Jump straight back to a configured view.">
            {filters.length === 0 ? (
              <Empty
                icon={Bookmark}
                title="No filters saved"
                description='Tap "Save filter" next to any filter bar to pin it here.'
              />
            ) : (
              <Card className="gap-0 py-0">
                <ul className="divide-y">
                  {filters.map((f) => (
                    <li key={f.id} className="flex items-center gap-1 pr-2">
                      <Link
                        href={`${f.path}${f.search ? `?${f.search}` : ""}`}
                        className="min-w-0 flex-1 px-4 py-3 transition-colors hover:bg-muted/50"
                      >
                        <div className="truncate text-sm font-medium">{f.label}</div>
                        <div className="truncate font-mono text-xs text-muted-foreground">
                          {f.path}
                          {f.search ? `?${f.search}` : ""}
                        </div>
                      </Link>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-10 shrink-0 text-muted-foreground"
                        onClick={() => saved.remove(f.id)}
                        aria-label={`Remove ${f.label}`}
                      >
                        <X />
                      </Button>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </PageSection>

          <PageSection
            title="Recently viewed"
            description="Your last 8 pages."
            actions={
              visits.length > 0 ? (
                <Button variant="ghost" size="sm" className="h-10 sm:h-7" onClick={() => recent.clear()}>
                  Clear
                </Button>
              ) : null
            }
          >
            {visits.length === 0 ? (
              <Empty icon={Clock} title="Nothing here yet" description="Pages you open are listed here." />
            ) : (
              <Card className="gap-0 py-0">
                <ul className="divide-y">
                  {visits.map((v) => (
                    <li key={`${v.path}-${v.at}`}>
                      <Link
                        href={`${v.path}${v.search ? `?${v.search}` : ""}`}
                        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{v.title}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(v.at), { addSuffix: true })}
                          </div>
                        </div>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </PageSection>
        </div>
      </div>
    </div>
  );
}

/** Members: merchants hidden from the ads table and the arbitrage/compare
 *  books, with unblock. Guests: a short pitch. */
function BlockedMerchants({ blocklist }: { blocklist: ReturnType<typeof useBlocklist> }) {
  if (blocklist.mode === "loading") return null;
  if (!blocklist.enabled) {
    return (
      <PageSection title="Blocked merchants" description="Hide a merchant's ads everywhere in the app.">
        <Empty
          icon={Lock}
          title="Members can block merchants"
          description="Create a free account to hide ads from merchants you don't trust, on every device."
          action={
            <Button render={<Link href="/sign-up" />} nativeButton={false} className="h-10 sm:h-8">
              Create a free account
            </Button>
          }
        />
      </PageSection>
    );
  }
  return (
    <PageSection
      title="Blocked merchants"
      description="Their ads are hidden from the Markets table and the arbitrage and compare books."
    >
      {blocklist.items.length === 0 ? (
        <Empty
          icon={Ban}
          title="No one blocked"
          description='Open a merchant and tap "Block" to hide their ads.'
        />
      ) : (
        <Card className="gap-0 py-0">
          <ul className="divide-y">
            {blocklist.items.map((m) => (
              <li key={m.key} className="flex items-center gap-3 px-4 py-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Ban className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/merchants/${encodeURIComponent(m.id)}`}
                    className="block truncate text-sm font-medium underline-offset-2 hover:underline"
                  >
                    {m.name}
                  </Link>
                  <div className="truncate text-xs text-muted-foreground">
                    {EXCHANGES[m.exchange]?.label ?? m.exchange}
                    {" · blocked "}
                    {formatDistanceToNow(new Date(m.addedAt), { addSuffix: true })}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10 shrink-0 sm:h-8"
                  onClick={() => {
                    blocklist.unblock(m.exchange, m.id);
                    toast(`${m.name} unblocked`);
                  }}
                >
                  Unblock
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </PageSection>
  );
}
