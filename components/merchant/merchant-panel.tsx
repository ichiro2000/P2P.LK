"use client";

import { useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import type { ExchangeId } from "@/lib/exchanges";
import type { MarketSnapshot, NormalizedAd } from "@/lib/types";
import type { MerchantRow } from "@/lib/analytics";
import type { ShowcaseMap } from "@/lib/market-insights";
import { usePolling } from "@/hooks/use-polling";
import { KpiCard } from "@/components/common/kpi-card";
import { KpiGrid } from "@/components/common/page";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { formatCompact, formatPct, formatRelative } from "@/lib/format";
import { FIAT } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { InfoPopover } from "@/components/common/info-popover";
import type { FilterState } from "@/components/market/filter-bar";
import { MerchantTable } from "./merchant-table";
import { CompetitorCompare } from "./competitor-compare";
import { SpreadMedianText } from "./own-spread";
import { PageSection } from "@/components/common/page";
import { getExchange } from "@/lib/exchanges";
import { competitorInfoFrom, medianOwnSpread } from "@/lib/competitors";
import { ReliabilityInfo } from "./reliability-info";

type DirectoryResponse = {
  asset: string;
  fiat: string;
  fetchedAt: string;
  marketMedian: number | null;
  liveCount: number;
  knownCount: number;
  merchants: MerchantRow[];
  /** Full live book for the competitor compare (`book=1`). */
  book?: { ads: NormalizedAd[]; ts: number } | null;
};

export function MerchantPanel({
  initial,
  initialDirectory,
  filters,
  exchange,
  showcase,
  initialBook,
  selfId,
}: {
  initial: MarketSnapshot;
  initialDirectory: MerchantRow[];
  filters: FilterState;
  exchange: ExchangeId;
  showcase: ShowcaseMap;
  /** Every publisher, up to 100 ads a side; null when the cache is cold. */
  initialBook: { ads: NormalizedAd[]; ts: number } | null;
  /** The signed-in member's linked advertiser id on this exchange. */
  selfId: string | null;
}) {
  const [activeOnly, setActiveOnly] = useState(false);
  const [hideStatic, setHideStatic] = useState(false);
  const [query, setQuery] = useState("");

  const url = useMemo(() => {
    const p = new URLSearchParams({ exchange, book: "1" });
    if (filters.payType) p.set("payTypes", filters.payType);
    if (filters.merchantType === "merchant") p.set("publisher", "merchant");
    return `/api/merchants?${p.toString()}`;
  }, [filters, exchange]);

  const initialData = useMemo<DirectoryResponse>(
    () => ({
      asset: initial.asset,
      fiat: initial.fiat,
      fetchedAt: initial.fetchedAt,
      marketMedian: null,
      liveCount: initialDirectory.filter((m) => m.isActive).length,
      knownCount: initialDirectory.length,
      merchants: initialDirectory,
      book: initialBook,
    }),
    [initial, initialDirectory, initialBook],
  );

  const { data, loading, lastUpdated, refetch, error } = usePolling<DirectoryResponse>(url, {
    initialData,
    intervalMs: 30_000,
  });
  const directory = data?.merchants ?? initialDirectory;
  const book = data?.book ?? initialBook;
  const bookAds = useMemo(() => book?.ads ?? [], [book]);
  const info = useMemo(() => competitorInfoFrom(directory, bookAds), [directory, bookAds]);
  const spreadMedian = useMemo(() => medianOwnSpread(directory.filter((m) => m.isActive)), [directory]);

  const stats = useMemo(() => {
    const active = directory.filter((m) => m.isActive);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
    return {
      active: active.length,
      verified: directory.filter((m) => m.isMerchant).length,
      trust: avg(active.map((m) => m.trustScore)),
      completion: avg(active.map((m) => m.completionRate)),
      // Only live merchants have a tradable book — last-known depth of
      // offline merchants would inflate this.
      depth: active.reduce((s, m) => s + m.totalAvailableFiat, 0),
      flagged: directory.filter((m) => showcase[m.id]).length,
    };
  }, [directory, showcase]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      directory.filter(
        (m) =>
          (!activeOnly || m.isActive) &&
          (!hideStatic || !showcase[m.id]) &&
          (!q || m.name.toLowerCase().includes(q) || m.id.toLowerCase() === q),
      ),
    [directory, activeOnly, hideStatic, showcase, q],
  );

  return (
    <div className="space-y-6">
      <KpiGrid className="lg:grid-cols-5">
        <KpiCard
          label="Active now"
          value={stats.active.toString()}
          sub={`in the latest sweep · of ${directory.length} seen · ${stats.verified} verified`}
        />
        <KpiCard
          label="Avg reliability, active"
          value={stats.trust == null ? "—" : Math.round(stats.trust).toString()}
          sub="0–100 score"
          icon={<ReliabilityInfo className="-my-2" />}
        />
        <KpiCard
          label="Avg completion, active"
          value={formatPct(stats.completion, { frac: 1 })}
          sub="30-day order completion"
        />
        <KpiCard
          label="Live depth"
          value={`${FIAT.symbol} ${formatCompact(stats.depth)}`}
          sub={stats.flagged ? `${stats.flagged} look static (estimate)` : "Across active merchants"}
        />
        <KpiCard
          className="col-span-2 lg:col-span-1"
          label="Median own spread"
          value={spreadMedian ? `${FIAT.symbol} ${spreadMedian.lkr.toFixed(2)}` : "—"}
          sub={
            spreadMedian
              ? `${formatPct(spreadMedian.pct, { frac: 2 })} of mid · ${spreadMedian.count} two-sided${filters.merchantType === "merchant" ? " verified" : ""}`
              : "No two-sided merchants now"
          }
          icon={
            <InfoPopover label="What own spread means" title="Own spread">
              <p>
                A merchant&apos;s own spread = their best Sell-ad price (where users buy USDT) − their best Buy-ad
                price (where users sell USDT), per USDT, before fees. Only merchants listing both sides now count.
              </p>
              <p>
                <SpreadMedianText median={spreadMedian} scope={filters.merchantType === "merchant" ? "verified merchants" : "advertisers"} />
              </p>
            </InfoPopover>
          }
        />
      </KpiGrid>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 md:flex-row md:items-center md:justify-between">
        <div className="relative md:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search merchant name"
            aria-label="Search merchants"
            className="h-10 pl-8 md:h-8"
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Toggle id="m-active" checked={activeOnly} onChange={setActiveOnly} label={`Active now (${stats.active})`} />
          <Toggle
            id="m-static"
            checked={hideStatic}
            onChange={setHideStatic}
            label={`Hide static ads (${stats.flagged})`}
          />
        </div>
      </div>

      <MerchantTable merchants={filtered} exchange={exchange} showcase={showcase} spreadMedian={spreadMedian} />

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span aria-live="polite" suppressHydrationWarning>
          {error
            ? `Feed offline: ${error.message}`
            : `Showing ${filtered.length} of ${directory.length} · updates every 30 s · last ${
                lastUpdated ? formatRelative(new Date(lastUpdated)) : "just now"
              }`}
        </span>
        <button
          type="button"
          onClick={() => refetch()}
          className="inline-flex h-10 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      <PageSection
        id="compare"
        title="Compare competitors"
        description="Pick a merchant (or a custom minimum order) and see who competes for the same takers right now."
      >
        {book ? (
          <CompetitorCompare
            exchange={exchange}
            ads={bookAds}
            bookTs={book.ts}
            info={info}
            selfId={selfId}
            pickable
            payTypes={getExchange(exchange).bankPayTypes}
            onRefresh={() => refetch()}
            refreshing={loading}
            scopeNote="every publisher, all bank rails, top 100 a side"
          />
        ) : (
          <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            The live book isn&apos;t available right now. Try again in a minute.
          </p>
        )}
      </PageSection>
    </div>
  );
}

function Toggle({
  id,
  checked,
  onChange,
  label,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <Label htmlFor={id} className="flex min-h-10 cursor-pointer items-center gap-2 text-sm font-normal">
      <Switch id={id} checked={checked} onCheckedChange={(v) => onChange(Boolean(v))} />
      {label}
    </Label>
  );
}
