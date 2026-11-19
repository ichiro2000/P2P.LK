"use client";

import { useMemo, useState } from "react";
import type { MarketSnapshot } from "@/lib/types";
import { methodBreakdown, TOP_N_OPTIONS, type MethodRow, type TopN } from "@/lib/market-insights";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCompact, formatFiat, formatPct } from "@/lib/format";
import { FIAT } from "@/lib/constants";
import { Segmented } from "./segmented";
import { getExchange, payTypeLabel, resolvePayTypes, type ExchangeId } from "@/lib/exchanges";

const sym = FIAT.symbol;
const TOP_OPTS = TOP_N_OPTIONS.map((n) => ({ value: String(n) as `${TopN}`, label: `Top ${n}` }));

/**
 * Per-payment-method breakdown (PLAN 6b.2): average price of the best N ads
 * on each side, the spread between them, and depth. Cards on phones, a
 * table from `md` up.
 */
export function MethodBreakdown({
  market,
  exchange,
  payType = "",
}: {
  market: MarketSnapshot;
  exchange: ExchangeId;
  /** The filter selection the book was fetched with ("" = bank rails). */
  payType?: string;
}) {
  const [top, setTop] = useState<`${TopN}`>("3");
  const rows = useMemo(() => methodBreakdown(market.ads, Number(top)), [market.ads, top]);
  // The book is fetched for the filtered methods only, so any other method
  // only shows ads that also accept one of those — not that method's market.
  const adapter = getExchange(exchange);
  const queried = new Set(resolvePayTypes(adapter, payType));
  const subset = (r: MethodRow) => !queried.has(r.id);
  const via = payType ? (payTypeLabel(adapter, payType) ?? "the filtered method") : "bank transfer";

  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs text-muted-foreground">
          {rows.length} method{rows.length === 1 ? "" : "s"} on the visible book
        </span>
        <Segmented label="Average over best N ads" value={top} onChange={setTop} options={TOP_OPTS} />
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">No ads on the book.</p>
      ) : (
        <>
          <ul className="divide-y divide-border md:hidden">
            {rows.map((r) => (
              <MethodCard key={r.id} r={r} subset={subset(r) ? via : null} />
            ))}
          </ul>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">Method</TableHead>
                  <TableHead className="text-right">Buy USDT at</TableHead>
                  <TableHead className="text-right">Sell USDT at</TableHead>
                  <TableHead className="text-right">Spread</TableHead>
                  <TableHead className="text-right">Ask depth</TableHead>
                  <TableHead className="pr-4 text-right">Bid depth</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="pl-4 font-medium">
                      {r.name}
                      {subset(r) && <SubsetNote via={via} />}
                    </TableCell>
                    <TableCell className="text-right">
                      <Price v={r.buyPrice} tone="buy" />
                      <Count n={r.askCount} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Price v={r.sellPrice} tone="sell" />
                      <Count n={r.bidCount} />
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      <div>{formatFiat(r.spread, sym, 2)}</div>
                      <div className="text-[11px] text-muted-foreground">{formatPct(r.spreadPct, { frac: 2 })}</div>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatCompact(r.askDepth)}
                    </TableCell>
                    <TableCell className="pr-4 text-right font-mono tabular-nums">
                      {formatCompact(r.bidDepth)}
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

function SubsetNote({ via }: { via: string }) {
  return (
    <div className="text-[11px] font-normal text-muted-foreground">Subset: ads that also take {via}</div>
  );
}

function MethodCard({ r, subset }: { r: MethodRow; subset: string | null }) {
  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium">
          {r.name}
          {subset && <SubsetNote via={subset} />}
        </span>
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          spread {formatFiat(r.spread, sym, 2)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <div className="text-muted-foreground">Buy USDT at</div>
          <Price v={r.buyPrice} tone="buy" />
          <div className="text-[11px] text-muted-foreground">
            {r.askCount} ads · {formatCompact(r.askDepth)} USDT
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Sell USDT at</div>
          <Price v={r.sellPrice} tone="sell" />
          <div className="text-[11px] text-muted-foreground">
            {r.bidCount} ads · {formatCompact(r.bidDepth)} USDT
          </div>
        </div>
      </div>
    </li>
  );
}

function Price({ v, tone }: { v: number | null; tone: "buy" | "sell" }) {
  if (v == null) return <div className="font-mono text-sm text-muted-foreground">—</div>;
  return (
    <div
      className={
        tone === "buy"
          ? "font-mono text-sm font-medium tabular-nums text-[color:var(--color-buy)]"
          : "font-mono text-sm font-medium tabular-nums text-[color:var(--color-sell)]"
      }
    >
      {formatFiat(v, sym, 2)}
    </div>
  );
}

function Count({ n }: { n: number }) {
  return <div className="text-[11px] text-muted-foreground">{n} ads</div>;
}
