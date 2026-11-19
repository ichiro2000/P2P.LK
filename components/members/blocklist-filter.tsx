"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { EyeOff } from "lucide-react";
import { useBlocklist } from "@/hooks/use-member-data";
import type { LiveBooks } from "@/lib/compare";
import type { ExchangeId } from "@/lib/exchanges/types";
import type { NormalizedAd } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Client-side blocklist filtering, so market pages stay cacheable: the
 * server sends every ad, members' blocked merchants are dropped here.
 */
export function useBlockFilter() {
  const bl = useBlocklist();
  const [show, setShow] = useState(false);
  const active = bl.enabled && bl.count > 0 && !show;
  return { active, show, toggle: () => setShow((s) => !s), isBlocked: bl.isBlocked, has: bl.enabled && bl.count > 0 };
}

export type BlockFilter = ReturnType<typeof useBlockFilter>;

/** Ads from one exchange minus blocked merchants. */
export function useFilteredAds(ads: NormalizedAd[], exchange: ExchangeId, f: BlockFilter) {
  const { active, isBlocked } = f;
  return useMemo(() => {
    if (!active) return { ads, hidden: countBlocked(ads, exchange, isBlocked) };
    const kept = ads.filter((a) => !isBlocked(exchange, a.merchant.id));
    return { ads: kept, hidden: ads.length - kept.length };
  }, [ads, exchange, active, isBlocked]);
}

function countBlocked(ads: NormalizedAd[], exchange: ExchangeId, isBlocked: BlockFilter["isBlocked"]) {
  let n = 0;
  for (const a of ads) if (isBlocked(exchange, a.merchant.id)) n += 1;
  return n;
}

/** Both exchanges' books minus blocked merchants. */
export function useFilteredBooks(books: LiveBooks, f: BlockFilter) {
  const { active, isBlocked } = f;
  return useMemo(() => {
    let hidden = 0;
    const out = { ...books };
    for (const ex of Object.keys(books) as ExchangeId[]) {
      const b = books[ex];
      if (!b.ok) continue;
      if (!active) {
        hidden += countBlocked(b.buy, ex, isBlocked) + countBlocked(b.sell, ex, isBlocked);
        continue;
      }
      const buy = b.buy.filter((a) => !isBlocked(ex, a.merchant.id));
      const sell = b.sell.filter((a) => !isBlocked(ex, a.merchant.id));
      hidden += b.buy.length - buy.length + b.sell.length - sell.length;
      out[ex] = { ...b, buy, sell };
    }
    return { books: active ? out : books, hidden };
  }, [books, active, isBlocked]);
}

/** "N hidden by your blocklist · Show" (or "· Hide" while showing). */
export function BlocklistNote({ hidden, filter, className }: { hidden: number; filter: BlockFilter; className?: string }) {
  if (!filter.has || hidden === 0) return null;
  return (
    <p className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground", className)}>
      <EyeOff className="size-3.5 shrink-0" aria-hidden />
      <span>
        {filter.show
          ? `Showing ${hidden} ad${hidden === 1 ? "" : "s"} from merchants you blocked`
          : `${hidden} ad${hidden === 1 ? "" : "s"} hidden by your blocklist`}
      </span>
      <button
        type="button"
        onClick={filter.toggle}
        className="-my-2 inline-flex h-10 items-center font-medium text-foreground underline underline-offset-4 md:h-auto md:py-2"
      >
        {filter.show ? "Hide" : "Show"}
      </button>
      <Link href="/workspace" className="-my-2 inline-flex h-10 items-center underline-offset-4 hover:underline md:h-auto md:py-2">
        Manage
      </Link>
    </p>
  );
}
