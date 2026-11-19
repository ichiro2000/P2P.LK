"use client";

import { usePolling } from "@/hooks/use-polling";
import { PageSection } from "@/components/common/page";
import { summarize, type ComparePayload } from "@/lib/compare";
import { HeadToHead } from "./head-to-head";
import { SpreadOverlay } from "./spread-overlay";
import { MarketShare } from "./market-share";
import { BookConstructor } from "./book-constructor";
import { RangeSwitch } from "./range-switch";
import { BlocklistNote, useBlockFilter, useFilteredBooks } from "@/components/members/blocklist-filter";
import { useIncludeAllAds, useTradeAmount } from "@/hooks/use-trade-amount";

/** The compare page body. One poller feeds every section. */
export function CompareLive({
  initial,
  ranges,
  member,
}: {
  initial: ComparePayload;
  ranges: readonly string[];
  /** Server-known membership (7d/30d are members only). */
  member?: boolean;
}) {
  const range = initial.range;
  const { data, error } = usePolling<ComparePayload>(`/api/compare?range=${range}`, {
    initialData: initial,
    intervalMs: 30_000,
  });
  const p = data ?? initial;
  // The book constructor skips members' blocked merchants; the head-to-head
  // and history stay whole-market.
  const blockFilter = useBlockFilter();
  const filtered = useFilteredBooks(p.books, blockFilter);
  const [amount] = useTradeAmount();
  const [includeAll] = useIncludeAllAds();
  const opts = { includeOffline: includeAll, includeRestricted: includeAll };
  const a = summarize(p.books.binance, amount, opts);
  const b = summarize(p.books.bybit, amount, opts);

  return (
    <>
      {error && (
        <p className="text-xs text-[color:var(--color-warn)]" role="status">
          Couldn&apos;t refresh just now; showing the last data. Retrying.
        </p>
      )}

      <PageSection
        title="Head to head"
        description="Priced for your amount by walking each book (all bank rails, every publisher), with top of book alongside. Updated every 30 seconds."
      >
        <HeadToHead a={a} b={b} books={p.books} now={p.share.now} />
      </PageSection>

      <PageSection
        title="History"
        description="From our minute-by-minute snapshots."
        actions={<RangeSwitch value={range} options={ranges} member={member} />}
      >
        <div className="space-y-3">
          <SpreadOverlay points={p.spread} range={range} />
          <MarketShare series={p.share.series} now={p.share.now} range={range} />
        </div>
      </PageSection>

      <PageSection
        title="Order-book constructor"
        description="Build two books from any exchange, side and pay method, filter the merchants, and compare them row by row."
      >
        <div className="space-y-3">
          <BlocklistNote hidden={filtered.hidden} filter={blockFilter} />
          <BookConstructor books={filtered.books} />
        </div>
      </PageSection>
    </>
  );
}
