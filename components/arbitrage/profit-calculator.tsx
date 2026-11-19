"use client";

import { RotateCcw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ExchangeToggle, Field, PayMethodSelect } from "@/components/compare/book-controls";
import { KpiCard } from "@/components/common/kpi-card";
import { FIAT } from "@/lib/constants";
import { formatCompact, formatFiat, formatInt, formatPct, formatPrice, formatSigned } from "@/lib/format";
import { payMethodOptions, type LiveBooks } from "@/lib/compare";
import {
  askAds,
  bidAds,
  cycle,
  cappedCycles,
  num,
  profitAtRisk,
  roundTripCapacity,
  walkedCycle,
  type CycleResult,
  type Leg,
  type WalkedCycle,
} from "@/lib/arbitrage";
import { FeeFields, feesFrom, realismFrom, type FeeInputs } from "./cross-exchange";
import { AmountPicker } from "@/components/market/amount-picker";
import type { WalkOptions } from "@/lib/liquidity";

const S = FIAT.symbol;
const formatCycles = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export type CalcState = {
  buy: Leg;
  sell: Leg;
  /** null = follow the live best price. */
  buyPrice: string | null;
  sellPrice: string | null;
  cycles: string;
  slippage: boolean;
};

export const INITIAL_CALC: CalcState = {
  buy: { exchange: "binance", payType: "" },
  sell: { exchange: "bybit", payType: "" },
  buyPrice: null,
  sellPrice: null,
  cycles: "2",
  // Walk the book by default: the best ad alone rarely takes the whole capital.
  slippage: true,
};

/** Profit per cycle / day / month for one route, optionally walking the book. */
export function ProfitCalculator({
  books,
  state,
  onChange,
  fees,
  onFees,
  walkOpts,
}: {
  books: LiveBooks;
  state: CalcState;
  onChange: (patch: Partial<CalcState>) => void;
  fees: FeeInputs;
  onFees: (patch: Partial<FeeInputs>) => void;
  walkOpts?: WalkOptions;
}) {
  const asks = askAds(books, state.buy);
  const bids = bidAds(books, state.sell);
  const liveBuy = asks[0]?.price ?? null;
  const liveSell = bids[0]?.price ?? null;
  const buyPrice = state.buyPrice != null ? num(state.buyPrice) : liveBuy;
  const sellPrice = state.sellPrice != null ? num(state.sellPrice) : liveSell;
  const cross = state.buy.exchange !== state.sell.exchange;
  const capital = num(fees.capital);
  const f = feesFrom(fees);

  const res: CycleResult | WalkedCycle | null = state.slippage
    ? walkedCycle(asks, bids, capital, f, cross, walkOpts)
    : buyPrice != null && sellPrice != null
      ? cycle(capital, buyPrice, sellPrice, f, cross)
      : null;
  const walked = state.slippage && res ? (res as WalkedCycle) : null;
  const { risk, tol } = realismFrom(fees);
  const cap = roundTripCapacity(asks, bids, tol, walkOpts);
  const wantCycles = num(state.cycles);
  const cc = cappedCycles(wantCycles, cap.capitalLkr, capital);
  const perDay = res ? res.profit * cc.cycles : null;
  const atRisk = res ? profitAtRisk(res.profit, res.lkrBack, risk) : null;
  const tone = (v: number | undefined) => (v == null ? undefined : v > 0 ? "buy" : v < 0 ? "sell" : undefined);

  const leg = (key: "buy" | "sell") => {
    const l = state[key];
    const priceKey = key === "buy" ? "buyPrice" : "sellPrice";
    const live = key === "buy" ? liveBuy : liveSell;
    return (
      <Card className="gap-3 px-4 py-4">
        <div className="text-sm font-medium">
          {key === "buy" ? "1 · Buy USDT (sell ads)" : "2 · Sell USDT (buy ads)"}
        </div>
        <Field label="Exchange">
          <ExchangeToggle
            value={l.exchange}
            books={books}
            onChange={(exchange) =>
              onChange({ [key]: { exchange, payType: "" }, [priceKey]: null } as Partial<CalcState>)
            }
          />
        </Field>
        <Field label="Pay method">
          <PayMethodSelect
            value={l.payType}
            options={payMethodOptions(books[l.exchange])}
            onChange={(payType) => onChange({ [key]: { ...l, payType }, [priceKey]: null } as Partial<CalcState>)}
          />
        </Field>
        <Field label={`Price (${S} per USDT)`}>
          <div className="flex gap-2">
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              min={0}
              disabled={state.slippage}
              value={state[priceKey] ?? (live != null ? String(live) : "")}
              onChange={(e) => onChange({ [priceKey]: e.target.value } as Partial<CalcState>)}
              className="h-8 font-mono tabular-nums"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-8 shrink-0"
              disabled={state[priceKey] == null}
              onClick={() => onChange({ [priceKey]: null } as Partial<CalcState>)}
              aria-label="Use live price"
            >
              <RotateCcw /> Live
            </Button>
          </div>
        </Field>
        <p className="text-[11px] text-muted-foreground">
          {state.slippage
            ? "Walking the book: price comes from the fills below."
            : state[priceKey] == null
              ? `Following the live best price (${formatFiat(live, S, 2)}).`
              : `Edited. Live best is ${formatFiat(live, S, 2)}.`}
        </p>
      </Card>
    );
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {leg("buy")}
        {leg("sell")}
      </div>

      <Card className="gap-3 px-4 py-4">
        <AmountPicker label="Capital per cycle" showIncludeAll={false} />
        <FeeFields value={fees} onChange={onFees} showCapital={false} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Field label="Cycles per day">
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={state.cycles}
              onChange={(e) => onChange({ cycles: e.target.value })}
              className="h-10 font-mono tabular-nums md:h-8"
            />
          </Field>
          <label className="col-span-2 flex min-h-11 items-center gap-2 self-end text-xs sm:col-span-1 sm:min-h-8">
            <Switch checked={state.slippage} onCheckedChange={(v) => onChange({ slippage: Boolean(v) })} />
            Walk the book (slippage)
          </label>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {cross
            ? `Different exchanges: the ${fees.transferFeeUsdt || 0} USDT transfer fee is charged once per cycle.`
            : "Same exchange: no transfer fee is charged."}
        </p>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Profit per cycle"
          value={res ? `${formatSigned(res.profit, 0)}` : "—"}
          sub={res ? `${S} · ${formatPct(res.roi, { frac: 3, sign: true })} of capital` : "Enter capital and prices"}
          footer={res && `If the sell price slips ${formatPct(risk, { frac: 2 })}: ${formatSigned(atRisk, 0)} ${S}.`}
          tone={tone(res?.profit)}
        />
        <KpiCard
          label={cc.capped ? "Per day, capped by depth" : "Per day"}
          value={perDay != null ? formatSigned(perDay, 0) : "—"}
          sub={`${S} · ${formatCycles(cc.cycles)} cycle${cc.cycles === 1 ? "" : "s"}`}
          footer={cc.capped ? `You asked for ${wantCycles}; the books hold ${formatCycles(cc.cycles)} now.` : undefined}
          tone={tone(perDay ?? undefined)}
        />
        <KpiCard
          label={`Capacity within ${formatPct(tol, { frac: 1 })}`}
          value={cap.capitalLkr > 0 ? formatCompact(cap.capitalLkr) : "—"}
          sub={`${S} per round trip`}
          footer={cap.limitedBy ? `The ${cap.limitedBy === "buy" ? "buy" : "sell"} leg runs out first.` : undefined}
        />
        <KpiCard
          label="Break-even sell price"
          value={res?.breakEvenSell != null ? formatPrice(res.breakEvenSell) : "—"}
          sub={`${S} per USDT after fees`}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Per day = profit per cycle × cycles, with cycles capped at what the visible books take within{" "}
        {formatPct(tol, { frac: 1 })} of their best prices ({S} {formatCompact(cap.capitalLkr)} ÷ your capital,
        at least one walked cycle). Ads refill at an unknown pace, so treat it as a ceiling for right now, not a
        forecast; no monthly figure is shown for that reason.
        {cc.overCapacity && ` Your capital is above that capacity: one cycle already walks deeper into the book.`}
      </p>

      {res && (
        <Card className="gap-2 px-4 py-4 text-xs">
          <div className="text-sm font-medium">One cycle, step by step</div>
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 font-mono tabular-nums">
            <dt className="font-sans text-muted-foreground">Spend</dt>
            <dd className="text-right">{formatFiat(res.capital, S, 2)}</dd>
            <dt className="font-sans text-muted-foreground">
              Buy at {formatPrice(res.buyPrice)}
              {walked ? ` (avg of ${walked.buyAdsUsed} ads, top ${formatPrice(walked.topBuy)})` : ""}
            </dt>
            <dd className="text-right">{formatPrice(res.usdtBought)} USDT</dd>
            {res.transferFeeUsdt > 0 && (
              <>
                <dt className="font-sans text-muted-foreground">Transfer fee</dt>
                <dd className="text-right">−{formatPrice(res.transferFeeUsdt)} USDT</dd>
              </>
            )}
            <dt className="font-sans text-muted-foreground">
              Sell at {formatPrice(res.sellPrice)}
              {walked ? ` (avg of ${walked.sellAdsUsed} ads, top ${formatPrice(walked.topSell)})` : ""}
            </dt>
            <dd className="text-right">{formatPrice(res.usdtSold)} USDT</dd>
            <dt className="font-sans text-muted-foreground">Receive (after sell fee)</dt>
            <dd className="text-right">{formatFiat(res.lkrBack, S, 2)}</dd>
            {f.fixedCostLkr > 0 && (
              <>
                <dt className="font-sans text-muted-foreground">Other cost</dt>
                <dd className="text-right">−{formatFiat(f.fixedCostLkr, S, 2)}</dd>
              </>
            )}
            <dt className="font-sans font-medium">Profit</dt>
            <dd className="text-right font-medium">{formatSigned(res.profit, 2)} {S}</dd>
          </dl>
          {walked && (walked.buyShortfall > 0 || walked.sellShortfallUsdt > 0) && (
            <p className="text-[color:var(--color-warn)]">
              The visible book could not fill everything:
              {walked.buyShortfall > 0 && ` ${formatFiat(walked.buyShortfall, S, 0)} of capital unspent`}
              {walked.buyShortfall > 0 && walked.sellShortfallUsdt > 0 && ","}
              {walked.sellShortfallUsdt > 0 && ` ${formatInt(walked.sellShortfallUsdt)} USDT unsold`}. Profit and
              return are for the {formatFiat(walked.matchedCapital, S, 0)} that makes the full round trip.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
