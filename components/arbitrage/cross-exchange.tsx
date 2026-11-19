"use client";

import { ArrowRight, Calculator } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFeeSettings } from "@/hooks/use-fee-settings";
import { LEVEL_LABEL, makerFeeRate } from "@/lib/fees";
import { Field } from "@/components/compare/book-controls";
import { FIAT } from "@/lib/constants";
import { formatCompact, formatFiat, formatPct, formatSigned } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LiveBooks } from "@/lib/compare";
import {
  askAds,
  bidAds,
  num,
  opportunity,
  profitAtRisk,
  roundTripCapacity,
  walkedCycle,
  type Fees,
  type Leg,
  type Opportunity,
} from "@/lib/arbitrage";
import type { WalkOptions } from "@/lib/liquidity";
import { AmountPicker } from "@/components/market/amount-picker";

const S = FIAT.symbol;

export type FeeInputs = {
  capital: string;
  buyFeePct: string;
  sellFeePct: string;
  transferFeeUsdt: string;
  fixedCostLkr: string;
  /** Adverse price move during the transfer / payment window, %. */
  riskPct: string;
  /** Capacity = capital that round-trips with each leg's average within this % of its best price. */
  capTolPct: string;
};

/** Realism inputs as fractions (F31). */
export function realismFrom(f: FeeInputs) {
  return { risk: Math.max(0, num(f.riskPct)) / 100, tol: Math.max(0, num(f.capTolPct, 0.5)) / 100 };
}

export function feesFrom(f: FeeInputs): Fees {
  return {
    buyFee: num(f.buyFeePct) / 100,
    sellFee: num(f.sellFeePct) / 100,
    transferFeeUsdt: num(f.transferFeeUsdt),
    fixedCostLkr: num(f.fixedCostLkr),
  };
}

/** Shared fee inputs (used by cross-exchange, cross-method and the calculator). */
export function FeeFields({
  value,
  onChange,
  showCapital = true,
}: {
  value: FeeInputs;
  onChange: (patch: Partial<FeeInputs>) => void;
  showCapital?: boolean;
}) {
  const box = (key: keyof FeeInputs, label: string) => (
    <Field label={label}>
      <Input
        type="text"
        inputMode="decimal"
        value={value[key]}
        onChange={(e) => onChange({ [key]: e.target.value } as Partial<FeeInputs>)}
        className="h-10 font-mono tabular-nums md:h-8"
      />
    </Field>
  );
  const [feeSettings] = useFeeSettings();
  const maker = (makerFeeRate(feeSettings) * 100).toFixed(3);
  const preset = (buy: string, sell: string, label: string) => {
    const active = value.buyFeePct === buy && value.sellFeePct === sell;
    return (
      <Button
        type="button"
        size="sm"
        variant={active ? "secondary" : "outline"}
        aria-pressed={active}
        className="h-9 text-xs"
        onClick={() => onChange({ buyFeePct: buy, sellFeePct: sell })}
      >
        {label}
      </Button>
    );
  };
  return (
    <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>Fees per leg:</span>
      {preset("0", "0", "I take both ads (0%)")}
      {preset(maker, "0", `I post the buy ad (${maker}%)`)}
      {preset("0", maker, `I post the sell ad (${maker}%)`)}
      {preset(maker, maker, "I post both")}
      <span className="w-full sm:w-auto">
        Maker rate from &ldquo;Your fees&rdquo; ({LEVEL_LABEL[feeSettings.level]}). Takers pay no trading fee.
      </span>
    </div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {showCapital && box("capital", `Capital (${S})`)}
      {box("buyFeePct", "Buy fee %")}
      {box("sellFeePct", "Sell fee %")}
      {box("transferFeeUsdt", "Transfer fee (USDT)")}
      {box("fixedCostLkr", `Other cost / cycle (${S})`)}
      {box("riskPct", "Price risk ± %")}
      {box("capTolPct", "Capacity band %")}
    </div>
    </div>
  );
}

/** Buy on one exchange, sell on the other, priced by walking both books
 *  for the chosen capital. */
export function CrossExchange({
  books,
  fees,
  onFees,
  onOpen,
  walkOpts,
}: {
  books: LiveBooks;
  fees: FeeInputs;
  onFees: (patch: Partial<FeeInputs>) => void;
  onOpen: (buy: Leg, sell: Leg) => void;
  walkOpts?: WalkOptions;
}) {
  const routes: [Leg, Leg][] = [
    [{ exchange: "binance", payType: "" }, { exchange: "bybit", payType: "" }],
    [{ exchange: "bybit", payType: "" }, { exchange: "binance", payType: "" }],
  ];
  return (
    <div className="space-y-3">
      <Card className="gap-3 px-4 py-4">
        <div className="text-sm font-medium">Size and fees</div>
        <AmountPicker label="Capital per cycle" />
        <FeeFields value={fees} onChange={onFees} showCapital={false} />
        <p className="text-[11px] text-muted-foreground">
          P2P takers usually pay no trading fee on Binance or Bybit; the USDT withdrawal (network) fee
          is the main cost of moving between exchanges. Check the current fee for your network. Price
          risk is how far the sell price may move against you while the USDT is in transit and the
          payment window runs (15 min on both exchanges); capacity is the most capital that makes the
          round trip with each leg&apos;s average within the band of its best price. Bank-side costs are
          not modelled: transfer fees, per-transfer caps and CEFTS vs SLIPS timing.
        </p>
      </Card>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {routes.map(([buy, sell]) => (
          <OpportunityCard
            key={`${buy.exchange}-${sell.exchange}`}
            o={opportunity(books, buy, sell)}
            books={books}
            fees={fees}
            cross
            walkOpts={walkOpts}
            onOpen={() => onOpen(buy, sell)}
          />
        ))}
      </div>
    </div>
  );
}

export function OpportunityCard({
  o,
  books,
  fees,
  cross,
  buyLabel,
  sellLabel,
  onOpen,
  walkOpts,
}: {
  o: Opportunity;
  books: LiveBooks;
  fees: FeeInputs;
  cross: boolean;
  buyLabel?: string;
  sellLabel?: string;
  onOpen: () => void;
  walkOpts?: WalkOptions;
}) {
  const capital = num(fees.capital);
  // Price the whole capital by walking both books (F10), not the best ad.
  const asks = askAds(books, o.buy);
  const bids = bidAds(books, o.sell);
  const res = walkedCycle(asks, bids, capital, feesFrom(fees), cross, walkOpts);
  const { risk, tol } = realismFrom(fees);
  const cap = roundTripCapacity(asks, bids, tol, walkOpts);
  const atRisk = res ? profitAtRisk(res.profit, res.lkrBack, risk) : null;
  const grossPos = (o.gross ?? 0) > 0;
  const netPos = (res?.profit ?? 0) > 0;
  const bl = buyLabel ?? books[o.buy.exchange]?.label;
  const sl = sellLabel ?? books[o.sell.exchange]?.label;
  const notes: string[] = [];
  if (res && res.buyShortfall > 0)
    notes.push(`Only ${S} ${formatCompact(res.capital)} of the capital fills on the ${bl} sell ads.`);
  if (res && res.sellShortfallUsdt > 0)
    notes.push(
      `${formatCompact(res.sellShortfallUsdt)} USDT can't be sold on the visible ${sl} buy ads; net is for the ${S} ${formatCompact(res.matchedCapital)} that makes the round trip.`,
    );

  return (
    <Card className="gap-3 px-4 py-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className="truncate">Buy on {bl}</span>
        <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">sell on {sl}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Buy at, avg for {S} {formatCompact(capital)}</dt>
          <dd className="font-mono tabular-nums text-[color:var(--color-buy)]">{formatFiat(res?.buyPrice ?? null, S, 2)}</dd>
          <dd className="text-[11px] text-muted-foreground">best ad {formatFiat(o.buyPrice, S, 2)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Sell at, avg</dt>
          <dd className="font-mono tabular-nums text-[color:var(--color-sell)]">{formatFiat(res?.sellPrice ?? null, S, 2)}</dd>
          <dd className="text-[11px] text-muted-foreground">best ad {formatFiat(o.sellPrice, S, 2)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Top-of-book gap / USDT</dt>
          <dd className={cn("font-mono tabular-nums", o.gross != null && (grossPos ? "text-[color:var(--color-buy)]" : "text-[color:var(--color-sell)]"))}>
            {formatSigned(o.gross, 2)} {S} · {formatPct(o.grossPct, { frac: 3, sign: true })}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Net on {S} {capital.toLocaleString("en-US")}, walked</dt>
          <dd className={cn("font-mono tabular-nums", res && (netPos ? "text-[color:var(--color-buy)]" : "text-[color:var(--color-sell)]"))}>
            {res ? `${formatSigned(res.profit, 0)} ${S} · ${formatPct(res.roi, { frac: 3, sign: true })}` : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Capacity within {formatPct(tol, { frac: 1 })}</dt>
          <dd className="font-mono tabular-nums">{cap.capitalLkr > 0 ? `${S} ${formatCompact(cap.capitalLkr)}` : "—"}</dd>
          <dd className="text-[11px] text-muted-foreground">
            {cap.limitedBy === "buy" ? `${bl} sell ads run out first` : cap.limitedBy === "sell" ? `${sl} buy ads run out first` : "a side is empty"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">If the sell price slips {formatPct(risk, { frac: 2 })}</dt>
          <dd className={cn("font-mono tabular-nums", atRisk != null && (atRisk > 0 ? "text-[color:var(--color-buy)]" : "text-[color:var(--color-sell)]"))}>
            {atRisk != null ? `${formatSigned(atRisk, 0)} ${S}` : "—"}
          </dd>
          <dd className="text-[11px] text-muted-foreground">{cross ? "during the transfer and payment" : "during the payment window"}</dd>
        </div>
      </dl>
      {cap.capitalLkr > 0 && capital > cap.capitalLkr && notes.length === 0 && (
        <p className="text-[11px] text-[color:var(--color-warn)]">
          Your {S} {formatCompact(capital)} is above the {S} {formatCompact(cap.capitalLkr)} the books take within {formatPct(tol, { frac: 1 })}: the walked prices above already include the extra slippage.
        </p>
      )}
      {notes.map((n) => (
        <p key={n} className="text-[11px] text-[color:var(--color-warn)]">
          {n}
        </p>
      ))}
      {!res && o.buyAd && o.sellAd && (
        <p className="text-[11px] text-[color:var(--color-warn)]">No usable ad accepts this amount on one of the legs.</p>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] text-muted-foreground">
          {o.buyAd && o.sellAd ? `${o.buyAd.merchant.name} → ${o.sellAd.merchant.name}` : "One side has no ads."}
        </span>
        <Button variant="outline" size="sm" onClick={onOpen} disabled={!o.buyAd || !o.sellAd}>
          <Calculator /> Calculator
        </Button>
      </div>
    </Card>
  );
}
