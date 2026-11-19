"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import { usePolling } from "@/hooks/use-polling";
import { PageSection } from "@/components/common/page";
import { Card } from "@/components/ui/card";
import type { BooksPayload } from "@/lib/compare";
import type { Leg } from "@/lib/arbitrage";
import { CrossExchange, type FeeInputs } from "./cross-exchange";
import { CrossMethod } from "./cross-method";
import { MakerSpread } from "./maker-spread";
import { INITIAL_CALC, ProfitCalculator, type CalcState } from "./profit-calculator";
import { BlocklistNote, useBlockFilter, useFilteredBooks } from "@/components/members/blocklist-filter";
import { useIncludeAllAds, useTradeAmount } from "@/hooks/use-trade-amount";

const INITIAL_FEES: FeeInputs = {
  // Overwritten by the shared "your amount" (Markets / Compare / Arbitrage).
  capital: "100000",
  buyFeePct: "0",
  sellFeePct: "0",
  transferFeeUsdt: "1",
  fixedCostLkr: "0",
  // F31: a ±0.2 % move over a 15–30 min window is an editable guess, not a measured σ.
  riskPct: "0.2",
  capTolPct: "0.5",
};

/** The arbitrage page body. One poller (books only) feeds every tool. */
export function ArbitrageLive({ initial }: { initial: BooksPayload }) {
  const { data, error } = usePolling<BooksPayload>("/api/compare?view=books", {
    initialData: initial,
    intervalMs: 30_000,
  });
  // Members' blocked merchants are dropped from every tool below.
  const blockFilter = useBlockFilter();
  const { books, hidden } = useFilteredBooks((data ?? initial).books, blockFilter);
  const [feeInputs, setFees] = useState<FeeInputs>(INITIAL_FEES);
  const [calc, setCalc] = useState<CalcState>(INITIAL_CALC);
  const [amount] = useTradeAmount();
  const [includeAll] = useIncludeAllAds();
  const walkOpts = { includeOffline: includeAll, includeRestricted: includeAll };
  const fees: FeeInputs = { ...feeInputs, capital: String(amount) };
  const onFees = (patch: Partial<FeeInputs>) => setFees((f) => ({ ...f, ...patch }));

  const openInCalculator = (buy: Leg, sell: Leg) => {
    setCalc((c) => ({ ...c, buy, sell, buyPrice: null, sellPrice: null }));
    document.getElementById("calculator")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <Card className="flex-row gap-3 border-[color:var(--color-warn)]/40 px-4 py-3">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[color:var(--color-warn)]" aria-hidden />
        <div className="space-y-1 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Not financial advice.</p>
          <p>
            These are estimates from public ads. Prices move between the buy and the sell, ads fill or
            vanish, and order limits apply. Every P2P trade carries counterparty risk: payment
            reversals, frozen bank accounts and scams. Trade only with amounts you can afford to lose.
          </p>
        </div>
      </Card>

      <BlocklistNote hidden={hidden} filter={blockFilter} />

      {error && (
        <p className="text-xs text-[color:var(--color-warn)]" role="status">
          Couldn&apos;t refresh just now; showing the last books. Retrying.
        </p>
      )}

      <PageSection
        title="Cross-exchange"
        description="Buy USDT on one exchange, move it, and sell it on the other. Both legs are priced by walking the visible book for your capital."
      >
        <CrossExchange books={books} fees={fees} onFees={onFees} onOpen={openInCalculator} walkOpts={walkOpts} />
      </PageSection>

      <PageSection
        title="Cross-method"
        description="Buy via one pay method and sell via another on the same exchange."
      >
        <CrossMethod books={books} fees={fees} onOpen={openInCalculator} walkOpts={walkOpts} />
      </PageSection>

      <PageSection
        id="maker"
        className="scroll-mt-20"
        title="Make the spread (merchant)"
        description="Taking both sides of one book loses the spread by construction. Posting your own Buy and Sell ads earns it, minus maker fees and price risk."
      >
        <MakerSpread books={books} walkOpts={walkOpts} />
      </PageSection>

      <PageSection
        id="calculator"
        className="scroll-mt-20"
        title="Profit per cycle"
        description="Prices start from the live books and follow them until you edit one. Per day is capped by what the visible books can absorb; there is no per-month figure because nothing guarantees the book refills."
      >
        <ProfitCalculator
          books={books}
          state={calc}
          onChange={(patch) => setCalc((c) => ({ ...c, ...patch }))}
          fees={fees}
          onFees={onFees}
          walkOpts={walkOpts}
        />
      </PageSection>
    </>
  );
}
