"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { ExchangeToggle, Field } from "@/components/compare/book-controls";
import { payMethodOptions, type LiveBooks } from "@/lib/compare";
import { methodPairs, type Leg } from "@/lib/arbitrage";
import type { ExchangeId } from "@/lib/exchanges/types";
import { OpportunityCard, type FeeInputs } from "./cross-exchange";
import type { WalkOptions } from "@/lib/liquidity";

/** Buy via one pay method and sell via another on the same exchange. */
export function CrossMethod({
  books,
  fees,
  onOpen,
  walkOpts,
}: {
  books: LiveBooks;
  fees: FeeInputs;
  onOpen: (buy: Leg, sell: Leg) => void;
  walkOpts?: WalkOptions;
}) {
  const [ex, setEx] = useState<ExchangeId>("binance");
  const methods = payMethodOptions(books[ex]);
  const pairs = methodPairs(books, ex, methods).slice(0, 6);

  return (
    <div className="space-y-3">
      <Card className="gap-3 px-4 py-4">
        <Field label="Exchange" className="max-w-xs">
          <ExchangeToggle value={ex} onChange={setEx} books={books} />
        </Field>
        <p className="text-[11px] text-muted-foreground">
          Every pair of pay methods seen on the {books[ex]?.label} book, best gross gap first. Many ads
          accept several methods, so the same ad can appear on both legs. Uses the fee inputs above
          (no transfer fee: the USDT stays on one exchange). Buying at the asks and selling into the bids of one book
          loses the spread, so these routes are usually negative; the profit is on the maker side
          (see “Make the spread” below).
        </p>
      </Card>
      {!books[ex]?.ok ? (
        <p className="text-sm text-muted-foreground">{books[ex]?.ok === false ? books[ex].error : ""}</p>
      ) : pairs.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          Only one pay method is listed on this book right now, so there is no cross-method route.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {pairs.map((o) => (
            <OpportunityCard
              key={`${o.buy.payType}-${o.sell.payType}`}
              o={o}
              books={books}
              fees={fees}
              cross={false}
              walkOpts={walkOpts}
              buyLabel={o.buyLabel}
              sellLabel={o.sellLabel}
              onOpen={() => onOpen(o.buy, o.sell)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
