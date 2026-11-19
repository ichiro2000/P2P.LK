"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import type { MarketSnapshot, NormalizedAd } from "@/lib/types";
import type { ShowcaseMap } from "@/lib/market-insights";
import { TierBadge } from "@/components/merchant/tier-badge";
import { ShowcaseBadge } from "@/components/merchant/showcase-badge";
import { deriveMerchantTier } from "@/lib/merchant-tier";
import { isTradable } from "@/lib/liquidity";
import { formatCompact, formatDuration, formatFiat, formatPct, formatCount } from "@/lib/format";
import { FIAT } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { Segmented } from "./segmented";
import type { ExchangeId } from "@/lib/exchanges/types";
import { BlocklistNote, useBlockFilter, useFilteredAds } from "@/components/members/blocklist-filter";

type Side = "BUY" | "SELL";
const sym = FIAT.symbol;

// Tabs are named for the visitor's action. "Buy USDT" shows publishers'
// SELL ads (green); "Sell USDT" shows their BUY ads (red).
const SIDE_OPTS = [
  { value: "SELL" as Side, label: "Buy USDT", className: "data-[pressed]:text-[color:var(--color-buy)]" },
  { value: "BUY" as Side, label: "Sell USDT", className: "data-[pressed]:text-[color:var(--color-sell)]" },
];

export function AdsTable({
  market,
  showcase,
  exchange,
}: {
  market: MarketSnapshot;
  showcase: ShowcaseMap;
  /** Needed to match members' blocklist entries. */
  exchange: ExchangeId;
}) {
  const [side, setSide] = useState<Side>("SELL");
  const blockFilter = useBlockFilter();
  const sideAds = useMemo(() => market.ads.filter((a) => a.tradeType === side), [market.ads, side]);
  const { ads: visible, hidden } = useFilteredAds(sideAds, exchange, blockFilter);
  const ads = [...visible].sort((a, b) => (side === "BUY" ? b.price - a.price : a.price - b.price));
  const median = side === "BUY" ? market.buy.medianPrice : market.sell.medianPrice;

  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs text-muted-foreground">
          {ads.length} ads · best first · vs near-touch median {formatFiat(median, sym, 2)}
        </span>
        <Segmented label="Ad side" value={side} onChange={setSide} options={SIDE_OPTS} />
      </div>
      <BlocklistNote hidden={hidden} filter={blockFilter} className="border-b border-border px-4 py-2" />

      {ads.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">No ads on this side.</p>
      ) : (
        <>
          <ul className="divide-y divide-border md:hidden">
            {ads.map((ad, i) => (
              <AdCard key={ad.id} ad={ad} best={i === 0} median={median} showcase={showcase} />
            ))}
          </ul>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">Advertiser</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead className="text-right">Limits ({sym})</TableHead>
                  <TableHead className="hidden lg:table-cell">Methods</TableHead>
                  <TableHead className="pr-4 text-right">Release</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ads.map((ad, i) => (
                  <TableRow key={ad.id} className={cn(i === 0 && "bg-muted/40", !isTradable(ad) && "opacity-60")}>
                    <TableCell className="max-w-64 py-2.5 pl-4">
                      <Advertiser ad={ad} showcase={showcase} />
                    </TableCell>
                    <TableCell className="py-2.5 text-right">
                      <PriceCell ad={ad} median={median} />
                    </TableCell>
                    <TableCell className="py-2.5 text-right font-mono tabular-nums">
                      {formatCompact(ad.available)}
                      <span className="ml-1 text-[11px] text-muted-foreground">USDT</span>
                    </TableCell>
                    <TableCell className="py-2.5 text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {formatCompact(ad.minOrder)}–{formatCompact(ad.maxOrder)}
                    </TableCell>
                    <TableCell className="hidden py-2.5 lg:table-cell">
                      <Methods ad={ad} />
                    </TableCell>
                    <TableCell className="py-2.5 pr-4 text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {formatDuration(ad.merchant.avgReleaseSec)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </Card>
  );
}

function AdCard({
  ad,
  best,
  median,
  showcase,
}: {
  ad: NormalizedAd;
  best: boolean;
  median: number | null;
  showcase: ShowcaseMap;
}) {
  return (
    <li className={cn("space-y-2 px-4 py-3", best && "bg-muted/40", !isTradable(ad) && "opacity-60")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Advertiser ad={ad} showcase={showcase} />
        </div>
        <PriceCell ad={ad} median={median} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="font-mono tabular-nums text-foreground">{formatCompact(ad.available)} USDT</span>
        <span className="font-mono tabular-nums">
          {sym} {formatCompact(ad.minOrder)}–{formatCompact(ad.maxOrder)}
        </span>
        {ad.merchant.avgReleaseSec != null && <span>release {formatDuration(ad.merchant.avgReleaseSec)}</span>}
        {ad.restricted && ad.restrictions?.length ? <span>needs {ad.restrictions.join(", ")}</span> : null}
      </div>
      <Methods ad={ad} />
    </li>
  );
}

function Advertiser({ ad, showcase }: { ad: NormalizedAd; showcase: ShowcaseMap }) {
  const m = ad.merchant;
  const flag = showcase[m.id];
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1.5">
        <Link
          href={`/merchants/${encodeURIComponent(m.id)}`}
          className="-my-2.5 truncate py-2.5 text-sm font-medium text-foreground underline-offset-4 hover:underline"
        >
          {m.name}
        </Link>
        <TierBadge
          tier={deriveMerchantTier({ isMerchant: m.isMerchant, userIdentity: m.userIdentity, vipLevel: m.vipLevel })}
          size="xs"
        />
        {flag && <ShowcaseBadge flag={flag} />}
        <AdFlags ad={ad} />
      </div>
      <div className="text-[11px] text-muted-foreground">
        <span className="font-mono tabular-nums">{formatCount(m.orders30d)}</span> orders ·{" "}
        <span className="font-mono tabular-nums">{formatPct(m.completionRate, { frac: 1 })}</span> done
      </div>
    </div>
  );
}

function PriceCell({ ad, median }: { ad: NormalizedAd; median: number | null }) {
  const vs = median && median > 0 ? (ad.price - median) / median : null;
  return (
    <div className="shrink-0 text-right">
      <div
        className={cn(
          "font-mono text-sm font-semibold tabular-nums",
          ad.tradeType === "SELL" ? "text-[color:var(--color-buy)]" : "text-[color:var(--color-sell)]",
        )}
      >
        {formatFiat(ad.price, sym, 2)}
      </div>
      {vs != null && (
        <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {Math.abs(vs) < 0.00005 ? "at median" : formatPct(vs, { frac: 2, sign: true })}
        </div>
      )}
    </div>
  );
}

function Methods({ ad }: { ad: NormalizedAd }) {
  return (
    <div className="flex flex-wrap gap-1">
      {ad.payMethods.slice(0, 3).map((pm) => (
        <span
          key={pm.id}
          className="inline-flex h-5 items-center rounded-sm bg-muted px-1.5 text-[10px] text-muted-foreground"
        >
          {pm.short ?? pm.name}
        </span>
      ))}
      {ad.payMethods.length > 3 && (
        <span className="inline-flex h-5 items-center rounded-sm border border-dashed border-border px-1.5 text-[10px] text-muted-foreground">
          +{ad.payMethods.length - 3}
        </span>
      )}
    </div>
  );
}

/** "Offline" / "Restricted" chips. Such ads are dimmed and left out of the
 *  walk unless the visitor includes them. */
function AdFlags({ ad }: { ad: NormalizedAd }) {
  const conditions = ad.restrictions?.join(" · ");
  return (
    <>
      {ad.online === false && (
        <span
          title="Advertiser is offline: orders may sit until they return. Left out of prices for your amount."
          className="inline-flex h-4 shrink-0 items-center rounded-sm border border-border px-1 text-[10px] text-muted-foreground"
        >
          Offline
        </span>
      )}
      {ad.restricted && (
        <span
          title={`Only for takers who meet: ${conditions ?? "the advertiser's conditions"}. Left out of prices for your amount.`}
          className="inline-flex h-4 shrink-0 items-center rounded-sm border border-[color:var(--color-warn)]/40 px-1 text-[10px] text-[color:var(--color-warn)]"
        >
          Restricted
        </span>
      )}
    </>
  );
}
