"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { InfoPopover } from "@/components/common/info-popover";
import { Field } from "@/components/compare/book-controls";
import { FIAT } from "@/lib/constants";
import { formatCompact, formatFiat, formatPct } from "@/lib/format";
import { num } from "@/lib/arbitrage";
import {
  PLACEMENT_RANKS,
  PRICE_TICK,
  placementMargins,
  toTick,
  placementPrice,
  type OrderLimits,
  type Placement,
} from "@/lib/placement";
import type { ExchangeId } from "@/lib/exchanges/types";
import type { MarketSnapshot, TradeType } from "@/lib/types";
import type { BookRank } from "@/lib/dashboard";
import { cn } from "@/lib/utils";
import { useFeeSettings } from "@/hooks/use-fee-settings";
import { LEVEL_LABEL, effectiveMakerFee, makerFeeRate } from "@/lib/fees";
import { FeeSettingsControl } from "@/components/common/fee-settings";
import { Segmented } from "./segmented";

const S = FIAT.symbol;
/** Ads per side the market feed returns. */
const FEED_ROWS = 20;

/** The signed-in member's own ads on the full book (server-rendered, optional). */
export type OwnPlacement = { id: string; name: string; ask: BookRank; bid: BookRank; scanned: number } | null;

type Rank = (typeof PLACEMENT_RANKS)[number];

/**
 * D2 · "Where to post to rank in the top N". The merchant picks the ad side,
 * a target rank and their own order limits; we find the price that beats
 * the Nth competing ad by one tick on the book the page already polls.
 */
export function AdPlacement({
  market,
  exchange,
  exchangeLabel,
  payTypeLabel,
  merchantsOnly,
  google,
  own,
}: {
  market: MarketSnapshot;
  exchange: ExchangeId;
  exchangeLabel: string;
  /** Bank rail the page is filtered to, or null for all rails. */
  payTypeLabel: string | null;
  merchantsOnly: boolean;
  google: number | null;
  own: OwnPlacement;
}) {
  const [side, setSide] = useState<TradeType>("SELL");
  const [rank, setRank] = useState<Rank>(3);
  const [minStr, setMin] = useState("50000");
  const [maxStr, setMax] = useState("500000");
  const limits: OrderLimits = { min: num(minStr), max: num(maxStr) };
  const badLimits = limits.max > 0 && limits.max < limits.min;
  const tick = PRICE_TICK[exchange];
  const opts = { limits, excludeMerchantId: own?.id ?? null, visibleCap: FEED_ROWS };
  const all = PLACEMENT_RANKS.map((n) => placementPrice(market.ads, side, n, tick, opts));
  const p = all[PLACEMENT_RANKS.indexOf(rank)];
  // "open": any price ranks; still show the price that leads every listed ad on the side.
  const listed = market.ads.filter((a) => a.tradeType === side && a.price > 0).map((a) => a.price);
  const leadAll =
    p.status === "open" && listed.length
      ? toTick(side === "SELL" ? Math.min(...listed) - tick : Math.max(...listed) + tick, tick)
      : null;
  const shown = p.price ?? leadAll;
  const m = placementMargins(shown, side, {
    mid: market.mid,
    google,
    bestBid: market.buy.bestPrice,
    bestAsk: market.sell.bestPrice,
  });
  const selling = side === "SELL";
  // Your maker fee on a typical order at your max size (rate after the level
  // discount, or the per-order minimum when that's larger).
  const [feeSettings] = useFeeSettings();
  const feeFrac =
    shown != null && shown > 0 && limits.max > 0
      ? effectiveMakerFee(limits.max / shown, 1, feeSettings)
      : makerFeeRate(feeSettings);
  // Selling USDT: the fee comes out of the USDT you sell → you net P × (1 − fee).
  // Buying USDT: the fee comes out of the USDT you receive → cost P ÷ (1 − fee).
  const netPrice = shown == null ? null : selling ? shown * (1 - feeFrac) : shown / (1 - feeFrac);
  const tone = selling ? "text-[color:var(--color-sell)]" : "text-[color:var(--color-buy)]";
  const ownRank = own ? (selling ? own.ask : own.bid) : null;
  const opposite = selling ? "best Buy ad (bid)" : "best Sell ad (ask)";
  const scope = `${merchantsOnly ? "verified-merchant" : "all"} ads in the top ${FEED_ROWS} on ${exchangeLabel}${payTypeLabel ? `, ${payTypeLabel}` : ", any bank rail"}`;

  return (
    <Card className="gap-4 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Where to post your ad</div>
          <p className="text-[11px] text-muted-foreground">
            The price that ranks your ad in the top {rank} against the ads takers would compare it with.
          </p>
        </div>
        <InfoPopover label="How the placement price is worked out" title="How it's worked out">
          <p>
            Competing ads are on the same side, online, without counterparty restrictions, able to fill an order
            (min order ≤ available × price), and their order range overlaps your min–max. A taker who wants{" "}
            {S} 50k never sees an ad that starts at {S} 500k.
          </p>
          <p>
            Sell ad: we undercut the Nth-cheapest competing ask by one tick ({S} {tick}). Buy ad: we outbid the
            Nth-highest competing bid by one tick. We never match the Nth price: ties have no guaranteed order.
          </p>
          <p>
            Ranked among {scope}. Ads deeper than the top {FEED_ROWS} are all priced worse, so they can&apos;t
            change a top-5 answer. Your rank also depends on the exchange&apos;s own sorting (some boost
            merchants or promoted ads), and the book moves every few seconds: treat this as where to start.
          </p>
          <p>
            Margins: vs mid = (best ask + best bid)/2; vs Google = Google&apos;s USD/LKR mid-market rate (USDT
            isn&apos;t exactly USD); vs the {opposite} = what one round trip makes before fees if your other leg
            fills at today&apos;s best opposite price.
          </p>
        </InfoPopover>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Field label="Your ad" className="col-span-2 sm:col-span-1">
          <Segmented<TradeType>
            label="Ad side"
            value={side}
            onChange={setSide}
            className="w-full"
            options={[
              { value: "SELL", label: "Sell ad · I sell USDT", className: "flex-1" },
              { value: "BUY", label: "Buy ad · I buy USDT", className: "flex-1" },
            ]}
          />
        </Field>
        <Field label="Target rank" className="col-span-2 sm:col-span-1">
          <Segmented<string>
            label="Target rank"
            value={String(rank)}
            onChange={(v) => setRank(Number(v) as Rank)}
            className="w-full"
            options={PLACEMENT_RANKS.map((n) => ({ value: String(n), label: `Top ${n}`, className: "flex-1" }))}
          />
        </Field>
        <Field label={`Your min order (${S})`}>
          <Input
            type="text"
            inputMode="decimal"
            value={minStr}
            onChange={(e) => setMin(e.target.value)}
            className="h-10 font-mono tabular-nums md:h-8"
          />
        </Field>
        <Field label={`Your max order (${S})`}>
          <Input
            type="text"
            inputMode="decimal"
            value={maxStr}
            onChange={(e) => setMax(e.target.value)}
            aria-invalid={badLimits || undefined}
            className="h-10 font-mono tabular-nums md:h-8"
          />
        </Field>
      </div>

      {badLimits ? (
        <p className="text-xs text-[color:var(--color-warn)]">Max order is below min order.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-1.5 rounded-lg border border-border px-3 py-3">
            <div className="text-xs text-muted-foreground">
              Post your {selling ? "Sell" : "Buy"} ad at
            </div>
            <div className={cn("font-mono text-2xl font-semibold tabular-nums", p.price != null && tone)}>
              {p.price != null ? formatFiat(p.price, S, 2) : "Any price"}
            </div>
            <p className="text-xs text-muted-foreground">{headline(p, selling)}</p>
            {leadAll != null && (
              <p className="text-xs text-muted-foreground">
                To also lead every listed {selling ? "Sell" : "Buy"} ad (offline, restricted or outside your limits):{" "}
                <span className={cn("font-mono tabular-nums", tone)}>{formatFiat(leadAll, S, 2)}</span>. Margins use
                this price.
              </p>
            )}
            {p.anchor && (
              <p className="text-[11px] text-muted-foreground">
                Beats {p.anchor.merchant.name} at {formatFiat(p.anchor.price, S, 2)} (orders {S}{" "}
                {formatCompact(p.anchor.minOrder)}–{formatCompact(Math.min(p.anchor.maxOrder || Infinity, p.anchor.available * p.anchor.price))}).
                Best competing today: {formatFiat(p.bestCompeting, S, 2)}.
              </p>
            )}
            <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-[11px] text-muted-foreground">
              {all.map((q) => (
                <span key={q.rank} className={cn(q.rank === rank && "text-foreground")}>
                  Top {q.rank}: <span className="font-mono tabular-nums">{q.price != null ? q.price.toFixed(2) : "any"}</span>
                </span>
              ))}
            </div>
          </div>

          <div className="min-w-0 space-y-2 rounded-lg border border-border px-3 py-3 text-xs">
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5">
              <dt className="text-muted-foreground">
                {selling ? "You net per USDT" : "Your cost per USDT"} after {(feeFrac * 100).toFixed(3)}% maker fee (
                {LEVEL_LABEL[feeSettings.level]})
              </dt>
              <dd className="text-right font-mono font-medium tabular-nums">{formatFiat(netPrice, S, 2)}</dd>
              <dt className="text-muted-foreground">vs mid {formatFiat(market.mid, S, 2)}</dt>
              <dd className="text-right font-mono tabular-nums">{formatPct(m.vsMid, { frac: 3, sign: true })}</dd>
              <dt className="text-muted-foreground">vs Google USD/LKR {google ? formatFiat(google, S, 2) : ""}</dt>
              <dd className="text-right font-mono tabular-nums">{formatPct(m.vsGoogle, { frac: 2, sign: true })}</dd>
              <dt className="text-muted-foreground">
                Round trip vs {opposite} {formatFiat(selling ? market.buy.bestPrice : market.sell.bestPrice, S, 2)}
              </dt>
              <dd
                className={cn(
                  "text-right font-mono tabular-nums",
                  m.vsOpposite != null && (m.vsOpposite > 0 ? "text-[color:var(--color-buy)]" : "text-[color:var(--color-sell)]"),
                )}
              >
                {formatPct(m.vsOpposite, { frac: 3, sign: true })}
              </dd>
            </dl>
            {m.crosses && (
              <p className="text-[color:var(--color-warn)]">
                This price crosses the book: you&apos;d {selling ? "sell below the best bid" : "buy above the best ask"}.
                Takers could trade against you at a loss to you.
              </p>
            )}
            {own && (
              <p className="border-t border-border pt-2 text-muted-foreground">
                {ownRank ? (
                  <>
                    Your {selling ? "Sell" : "Buy"} ad ({own.name}) is #{ownRank.position} of {ownRank.of}
                    {ownRank.capped ? "+" : ""} on the full {exchangeLabel} book at{" "}
                    <span className="font-mono tabular-nums">{formatFiat(ownRank.price, S, 2)}</span>.
                  </>
                ) : (
                  <>
                    {own.name} has no {selling ? "Sell" : "Buy"} ad in the top {own.scanned} on {exchangeLabel} right
                    now.
                  </>
                )}
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">Ranked among {scope}.</p>
          </div>
        </div>
      )}
      <FeeSettingsControl compact />
    </Card>
  );
}

function headline(p: Placement, selling: boolean): string {
  const ads = (n: number) => `${n} competing ad${n === 1 ? "" : "s"}`;
  switch (p.status) {
    case "undercut":
      return `Ranks #${p.rank} or better among ${ads(p.competing)}: one tick ${selling ? "below" : "above"} #${p.rank}.`;
    case "bounded":
      return `Only ${ads(p.competing)} in view; at this price you'd be #${p.rankAtPrice} at worst.`;
    case "open":
      return p.competing === 0
        ? "No online, unrestricted ad overlaps your limits: you'd rank #1 at any price. Price on margin."
        : `Only ${ads(p.competing)} overlap your limits: you'd rank #${p.rankAtPrice} at any price. Price on margin.`;
    default:
      return "No ads on this side right now.";
  }
}
