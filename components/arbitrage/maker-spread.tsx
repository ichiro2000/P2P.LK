"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FeeSettingsControl } from "@/components/common/fee-settings";
import { useFeeSettings } from "@/hooks/use-fee-settings";
import { effectiveMakerFee, makerFeeRate, ordersFor } from "@/lib/fees";
import { InfoPopover } from "@/components/common/info-popover";
import { KpiCard } from "@/components/common/kpi-card";
import { ExchangeToggle, Field, PayMethodSelect } from "@/components/compare/book-controls";
import { Segmented } from "@/components/market/segmented";
import { FIAT } from "@/lib/constants";
import { formatFiat, formatInt, formatPct, formatSigned } from "@/lib/format";
import { payMethodOptions, type LiveBooks } from "@/lib/compare";
import { num } from "@/lib/arbitrage";
import { makerCycle } from "@/lib/maker";
import { PLACEMENT_RANKS, PRICE_TICK, placementPrice, toTick, type Placement } from "@/lib/placement";
import type { ExchangeId } from "@/lib/exchanges/types";
import type { NormalizedAd, TradeType } from "@/lib/types";
import type { WalkOptions } from "@/lib/liquidity";

const S = FIAT.symbol;
/** Ads per side in the cached books. */
const FEED_ROWS = 20;

/**
 * Default maker fee per filled ad, in %. Source: Binance's June 2023
 * announcement set the LKR P2P maker fee at 0.10 % (VIP merchants get
 * 20–50 % off). Bybit doesn't publish an LKR maker fee in its ad data, so
 * the same figure is assumed. An editable assumption, not a fact.
 */
export const DEFAULT_MAKER_FEE_PCT = "0.10";

type Rank = (typeof PLACEMENT_RANKS)[number];

type State = {
  ex: ExchangeId;
  payType: string;
  rank: Rank;
  min: string;
  max: string;
  /** null = follow the placement price. */
  bid: string | null;
  ask: string | null;
  capital: string;
  /** null = follow "Your fees" (level discount + per-order minimum). */
  feeBuy: string | null;
  feeSell: string | null;
  cycles: string;
  risk: string;
};

const INITIAL: State = {
  ex: "binance",
  payType: "",
  rank: 1,
  min: "50000",
  max: "500000",
  bid: null,
  ask: null,
  capital: "500000",
  feeBuy: null,
  feeSell: null,
  cycles: "4",
  risk: "0.2",
};

/** Placement price, or (when any price ranks) one tick better than the best ad on the side. */
function suggested(p: Placement, ads: readonly NormalizedAd[], side: TradeType): number | null {
  if (p.price != null) return p.price;
  const prices = ads.filter((a) => a.tradeType === side && a.price > 0).map((a) => a.price);
  if (!prices.length) return null;
  return side === "SELL" ? toTick(Math.min(...prices) - p.tick, p.tick) : toTick(Math.max(...prices) + p.tick, p.tick);
}

/** D5 · A merchant quoting both sides on one exchange: spread, fees, break-even and price risk. */
export function MakerSpread({ books, walkOpts }: { books: LiveBooks; walkOpts?: WalkOptions }) {
  const [s, setS] = useState<State>(INITIAL);
  const [feeSettings] = useFeeSettings();
  const set = (patch: Partial<State>) => setS((x) => ({ ...x, ...patch }));

  const book = books[s.ex];
  const ads: NormalizedAd[] = book?.ok ? [...book.buy, ...book.sell] : [];
  const tick = PRICE_TICK[s.ex];
  const opts = {
    ...walkOpts,
    limits: { min: num(s.min), max: num(s.max) },
    payType: s.payType,
    visibleCap: FEED_ROWS,
  };
  const bidPlace = placementPrice(ads, "BUY", s.rank, tick, opts);
  const askPlace = placementPrice(ads, "SELL", s.rank, tick, opts);
  const liveBid = suggested(bidPlace, ads, "BUY");
  const liveAsk = suggested(askPlace, ads, "SELL");
  const bid = s.bid != null ? num(s.bid) : liveBid;
  const ask = s.ask != null ? num(s.ask) : liveAsk;
  const risk = num(s.risk) / 100;
  const cycles = num(s.cycles);
  // Fees from "Your fees": the level-discounted maker rate, with the
  // per-order minimum applied over the orders this capital needs at your
  // max order size. A typed value overrides it.
  const capitalNum = num(s.capital);
  const orders = ordersFor(capitalNum, num(s.max));
  const levelFee = (price: number | null) =>
    price != null && price > 0 ? effectiveMakerFee(capitalNum / price, orders, feeSettings) : makerFeeRate(feeSettings);
  const feeBuyFrac = s.feeBuy != null ? num(s.feeBuy) / 100 : levelFee(bid);
  const feeSellFrac = s.feeSell != null ? num(s.feeSell) / 100 : levelFee(ask);
  const r =
    bid != null && ask != null
      ? makerCycle({
          bid,
          ask,
          capital: num(s.capital),
          feeBuy: feeBuyFrac,
          feeSell: feeSellFrac,
          cyclesPerDay: cycles,
          riskBand: risk,
        })
      : null;
  const tone = (v: number | undefined) => (v == null ? undefined : v > 0 ? "buy" : v < 0 ? "sell" : undefined);

  const feeBox = (key: "feeBuy" | "feeSell", label: string, frac: number) => (
    <Field label={label}>
      <div className="flex gap-2">
        <Input
          type="text"
          inputMode="decimal"
          value={s[key] ?? (frac * 100).toFixed(3)}
          onChange={(e) => set({ [key]: e.target.value } as Partial<State>)}
          className="h-10 font-mono tabular-nums md:h-8"
        />
        {s[key] != null && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-10 shrink-0 md:h-8"
            onClick={() => set({ [key]: null } as Partial<State>)}
            aria-label="Mine: use my level fee"
          >
            <RotateCcw /> Mine
          </Button>
        )}
      </div>
    </Field>
  );

  const box = (key: "capital" | "cycles" | "risk" | "min" | "max", label: string) => (
    <Field label={label}>
      <Input
        type="text"
        inputMode="decimal"
        value={s[key]}
        onChange={(e) => set({ [key]: e.target.value } as Partial<State>)}
        className="h-10 font-mono tabular-nums md:h-8"
      />
    </Field>
  );

  const priceBox = (key: "bid" | "ask", live: number | null, p: Placement) => (
    <Field label={key === "bid" ? `Your Buy ad · you buy USDT at (${S})` : `Your Sell ad · you sell USDT at (${S})`}>
      <div className="flex gap-2">
        <Input
          type="text"
          inputMode="decimal"
          value={s[key] ?? (live != null ? live.toFixed(2) : "")}
          onChange={(e) => set({ [key]: e.target.value } as Partial<State>)}
          className="h-10 font-mono tabular-nums md:h-8"
        />
        <Button
          variant="outline"
          size="sm"
          className="h-10 shrink-0 md:h-8"
          disabled={s[key] == null}
          onClick={() => set({ [key]: null } as Partial<State>)}
          aria-label="Live: use the placement price"
        >
          <RotateCcw /> Live
        </Button>
      </div>
      <span className="text-[11px] text-muted-foreground">
        {s[key] != null
          ? `Edited. Top-${s.rank} price is ${formatFiat(live, S, 2)}.`
          : p.status === "undercut"
            ? `Top ${s.rank}: one tick ${key === "bid" ? "above" : "below"} ${p.anchor?.merchant.name ?? "#" + s.rank} (${p.competing} competing).`
            : p.status === "empty"
              ? "No ads on this side."
              : `Only ${p.competing} competing ad${p.competing === 1 ? "" : "s"}: one tick ${key === "bid" ? "above the best bid" : "below the best ask"}.`}
      </span>
    </Field>
  );

  return (
    <div className="space-y-3">
      <Card className="gap-4 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 text-[11px] text-muted-foreground">
            You post a Buy ad and a Sell ad on one exchange and earn the gap when takers fill both. Prices start
            at the top-{s.rank} placement for your limits (one tick inside the competing ads) and follow the live
            book until you edit them.
          </p>
          <InfoPopover label="Assumptions behind the maker P&L" title="Assumptions">
            <p>
              One cycle: your Buy ad fills for the whole capital, then your Sell ad sells the USDT back. Maker
              fees are taken from each filled ad. P2P takers on Binance and Bybit usually pay no trading fee;
              makers (advertisers) may. The {DEFAULT_MAKER_FEE_PCT} % default is Binance&apos;s announced LKR
              maker fee (June 2023, before VIP discounts of 20–50 %); Bybit doesn&apos;t publish one in its ad
              data, so the same is assumed. Check your own fee page and edit it.
            </p>
            <p>
              Break-even spread = bid ÷ ((1 − buy fee)(1 − sell fee)) − bid. Downside: while you wait for the
              second leg (a 15-minute payment window plus the time to get a taker), the market can move. We
              reprice the open leg by the risk band against you, the sell down or the buy up, and show the
              worse.
            </p>
            <p>
              Not included: bank charges, transfer limits, frozen accounts, chargebacks, partial fills and the
              time your capital sits idle. Cycles per day is your guess at taker flow on both ads; nothing here
              measures it.
            </p>
          </InfoPopover>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Exchange">
            <ExchangeToggle
              value={s.ex}
              books={books}
              onChange={(ex) => set({ ex, payType: "", bid: null, ask: null })}
            />
          </Field>
          <Field label="Payment method">
            <PayMethodSelect
              value={s.payType}
              options={payMethodOptions(book)}
              onChange={(payType) => set({ payType, bid: null, ask: null })}
            />
          </Field>
          <Field label="Target rank (both ads)">
            <Segmented<string>
              label="Target rank"
              value={String(s.rank)}
              onChange={(v) => set({ rank: Number(v) as Rank, bid: null, ask: null })}
              className="w-full"
              options={PLACEMENT_RANKS.map((n) => ({ value: String(n), label: `Top ${n}`, className: "flex-1" }))}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            {box("min", `Min order (${S})`)}
            {box("max", `Max order (${S})`)}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {priceBox("bid", liveBid, bidPlace)}
          {priceBox("ask", liveAsk, askPlace)}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {box("capital", `Capital per cycle (${S})`)}
          {feeBox("feeBuy", "Maker fee, Buy ad %", feeBuyFrac)}
          {feeBox("feeSell", "Maker fee, Sell ad %", feeSellFrac)}
          {box("cycles", "Cycles per day")}
          {box("risk", "Price risk ± %")}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Fees follow &ldquo;Your fees&rdquo; below: your level&apos;s maker rate, with the per-order minimum over{" "}
          {orders} order{orders === 1 ? "" : "s"} at your max order size. Type a value to override. Takers pay none.
        </p>
        <FeeSettingsControl />
      </Card>

      {!book?.ok ? (
        <p className="text-sm text-muted-foreground">{book?.ok === false ? book.error : ""}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard
              label="Gross spread / USDT"
              value={r ? formatSigned(r.grossPerUsdt, 2) : "—"}
              sub={r ? `${S} · ${formatPct(r.grossPct, { frac: 3, sign: true })}` : "Enter both prices"}
              footer={r && "Sell price − Buy price, as % of your bid."}
              tone={tone(r?.grossPerUsdt)}
            />
            <KpiCard
              label="Net per cycle"
              value={r ? formatSigned(r.netPerCycle, 0) : "—"}
              sub={r ? `${S} · ${formatPct(r.netPct, { frac: 3, sign: true })}` : `${S} after maker fees`}
              footer={r && `Gross ${formatSigned(r.grossPerCycle, 0)}, maker fees −${formatInt(r.feesPerCycle)}.`}
              tone={tone(r?.netPerCycle)}
            />
            <KpiCard
              label="Break-even spread"
              value={r ? r.breakEvenSpread.toFixed(2) : "—"}
              sub={r ? `${S} / USDT · ${formatPct(r.breakEvenPct, { frac: 3 })}` : `${S} / USDT`}
              footer={r && `At this bid, sell at ${r.breakEvenAsk.toFixed(2)} or more.`}
            />
            <KpiCard
              label={`Price moves ${formatPct(risk, { frac: 2 })}`}
              value={r ? formatSigned(r.downsidePerCycle, 0) : "—"}
              sub={`${S} per cycle`}
              footer={
                r &&
                `Worse case: ${r.downsideLeg === "sell" ? "your sell repriced down" : "your buy repriced up"}.${
                  r.breakEvenMove != null ? ` Loses money past ${formatPct(r.breakEvenMove, { frac: 2 })}.` : ""
                }`
              }
              tone={tone(r?.downsidePerCycle)}
            />
          </div>
          {r && (
            <p className="text-xs text-muted-foreground">
              At {cycles} cycle{cycles === 1 ? "" : "s"} a day: net{" "}
              <span className="font-mono tabular-nums text-foreground">{formatSigned(r.perDay, 0)} {S}</span>, or{" "}
              <span className="font-mono tabular-nums text-foreground">{formatSigned(r.downsidePerDay, 0)} {S}</span> if
              every cycle hits the risk band. Cycles are your assumption: each needs takers on both of your ads.
            </p>
          )}
          {bid != null && ask != null && ask <= bid && (
            <p className="text-xs text-[color:var(--color-warn)]">
              Your Sell price is at or below your Buy price: every cycle loses money.
            </p>
          )}
        </>
      )}
    </div>
  );
}
