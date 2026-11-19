"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TierBadge } from "@/components/merchant/tier-badge";
import { deriveMerchantTier } from "@/lib/merchant-tier";
import { FIAT } from "@/lib/constants";
import { formatCompact, formatFiat, formatInt, formatPct, formatSigned } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  NO_FILTER,
  constructBook,
  payMethodOptions,
  spreadBetween,
  type BookConfig,
  type LiveBooks,
} from "@/lib/compare";
import type { NormalizedAd, TradeType } from "@/lib/types";
import type { ExchangeId } from "@/lib/exchanges/types";
import { ExchangeToggle, Field, PayMethodSelect } from "./book-controls";

type BookId = "A" | "B";
type Pick = { book: BookId; ad: NormalizedAd };

const S = FIAT.symbol;
const COMPLETION_OPTIONS = [0, 90, 95, 98, 99] as const;

const sideLabel = (s: TradeType) => (s === "SELL" ? "Sell ads" : "Buy ads");
const sideHint = (s: TradeType) => (s === "SELL" ? "you buy USDT" : "you sell USDT");

/**
 * Order-book constructor: two books side by side (any exchange × side × pay
 * method) with merchant filters, the spread against the other book's same
 * row, and a pick-two-ads spread. On phones the books switch with tabs.
 */
export function BookConstructor({ books }: { books: LiveBooks }) {
  const [cfg, setCfg] = useState<Record<BookId, BookConfig>>({
    A: { exchange: "binance", side: "SELL", payType: "", filter: NO_FILTER },
    B: { exchange: "bybit", side: "BUY", payType: "", filter: NO_FILTER },
  });
  const [picks, setPicks] = useState<Pick[]>([]);
  const [tab, setTab] = useState<BookId>("A");

  const rows: Record<BookId, NormalizedAd[]> = {
    A: constructBook(books, cfg.A),
    B: constructBook(books, cfg.B),
  };

  const update = (id: BookId, patch: Partial<BookConfig>) =>
    setCfg((c) => {
      const next = { ...c[id], ...patch };
      // A pay method belongs to one exchange; reset it when the venue changes.
      if (patch.exchange && patch.exchange !== c[id].exchange) next.payType = "";
      return { ...c, [id]: next };
    });

  const togglePick = (book: BookId, ad: NormalizedAd) =>
    setPicks((ps) => {
      const i = ps.findIndex((p) => p.book === book && p.ad.id === ad.id);
      if (i >= 0) return ps.filter((_, j) => j !== i);
      return [...ps, { book, ad }].slice(-2);
    });

  // Re-read picked ads from the live book so prices track polling updates.
  const livePicks = picks.map((p) => {
    const cur = rows[p.book].find((a) => a.id === p.ad.id);
    return { ...p, ad: cur ?? p.ad, gone: !cur };
  });

  const title = (id: BookId) =>
    `${books[cfg[id].exchange]?.label ?? cfg[id].exchange} ${sideLabel(cfg[id].side).toLowerCase()}`;

  return (
    <div className="space-y-3">
      <PickSummary picks={livePicks} books={books} cfg={cfg} onClear={() => setPicks([])} />

      <ToggleGroup
        value={[tab]}
        onValueChange={(v) => v[0] && setTab(v[0] as BookId)}
        variant="outline"
        spacing={0}
        aria-label="Book"
        className="w-full lg:hidden"
      >
        {(["A", "B"] as const).map((id) => (
          <ToggleGroupItem key={id} value={id} className="min-w-0 flex-1 text-xs">
            <span className="truncate">
              {id} · {title(id)}
            </span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {(["A", "B"] as const).map((id) => {
          const other: BookId = id === "A" ? "B" : "A";
          return (
            <BookPanel
              key={id}
              id={id}
              className={cn(tab !== id && "hidden lg:flex")}
              cfg={cfg[id]}
              books={books}
              ads={rows[id]}
              otherAds={rows[other]}
              otherTitle={`${other} · ${title(other)}`}
              picked={(ad) => picks.some((p) => p.book === id && p.ad.id === ad.id)}
              onPick={(ad) => togglePick(id, ad)}
              onChange={(patch) => update(id, patch)}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ── One book ──────────────────────────────────────────────────────────── */

function BookPanel({
  id,
  cfg,
  books,
  ads,
  otherAds,
  otherTitle,
  picked,
  onPick,
  onChange,
  className,
}: {
  id: BookId;
  cfg: BookConfig;
  books: LiveBooks;
  ads: NormalizedAd[];
  otherAds: NormalizedAd[];
  otherTitle: string;
  picked: (ad: NormalizedAd) => boolean;
  onPick: (ad: NormalizedAd) => void;
  onChange: (patch: Partial<BookConfig>) => void;
  className?: string;
}) {
  const book = books[cfg.exchange];
  const methods = payMethodOptions(book);
  const f = cfg.filter;
  const setFilter = (patch: Partial<BookConfig["filter"]>) => onChange({ filter: { ...f, ...patch } });

  return (
    <Card className={cn("flex flex-col gap-3 py-4", className)}>
      <div className="space-y-3 px-4">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">Book {id}</h4>
          <span className="text-[11px] text-muted-foreground">
            {ads.length} ad{ads.length === 1 ? "" : "s"} · best first
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Exchange">
            <ExchangeToggle value={cfg.exchange} onChange={(exchange) => onChange({ exchange })} books={books} />
          </Field>
          <Field label="Side">
            <ToggleGroup
              value={[cfg.side]}
              onValueChange={(v) => v[0] && onChange({ side: v[0] as TradeType })}
              variant="outline"
              size="sm"
              spacing={0}
              aria-label="Ad side"
              className="w-full"
            >
              <ToggleGroupItem value="SELL" className="flex-1 text-xs">
                Sell ads
              </ToggleGroupItem>
              <ToggleGroupItem value="BUY" className="flex-1 text-xs">
                Buy ads
              </ToggleGroupItem>
            </ToggleGroup>
          </Field>
          <Field label="Pay method">
            <PayMethodSelect value={cfg.payType} onChange={(payType) => onChange({ payType })} options={methods} />
          </Field>
          <Field label="Min completion">
            <Select
              value={String(f.minCompletion)}
              onValueChange={(v) => setFilter({ minCompletion: Number(v ?? 0) })}
            >
              <SelectTrigger size="sm" className="w-full min-w-0">
                <SelectValue>{(v) => (Number(v) > 0 ? `${v}% or more` : "Any")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {COMPLETION_OPTIONS.map((c) => (
                  <SelectItem key={c} value={String(c)}>
                    {c > 0 ? `${c}% or more` : "Any"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Min 30-day orders">
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              step={10}
              value={f.minOrders || ""}
              placeholder="0"
              onChange={(e) => setFilter({ minOrders: Math.max(0, Number(e.target.value) || 0) })}
              className="h-7"
            />
          </Field>
          <label className="flex min-h-11 items-center gap-2 self-end text-xs sm:min-h-7">
            <Checkbox
              checked={f.verifiedOnly}
              onCheckedChange={(v) => setFilter({ verifiedOnly: Boolean(v) })}
            />
            Verified merchants only
          </label>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {sideLabel(cfg.side)}: {sideHint(cfg.side)}. Δ compares each row with the same row of {otherTitle}. Tap
          ads to pick two.
        </p>
      </div>

      <div className="border-t">
        {!book.ok ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">{book.error}</p>
        ) : ads.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            No ads match these filters in the top of this book.
          </p>
        ) : (
          <ol className="divide-y">
            {ads.map((ad, i) => (
              <AdRow
                key={ad.id}
                rank={i + 1}
                ad={ad}
                exchange={cfg.exchange}
                other={otherAds[i] ?? null}
                picked={picked(ad)}
                onPick={() => onPick(ad)}
              />
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}

function AdRow({
  rank,
  ad,
  exchange,
  other,
  picked,
  onPick,
}: {
  rank: number;
  ad: NormalizedAd;
  exchange: ExchangeId;
  other: NormalizedAd | null;
  picked: boolean;
  onPick: () => void;
}) {
  // Tier colours are Binance's convention; Bybit ads get no badge.
  const tier =
    exchange === "binance"
      ? deriveMerchantTier({
          isMerchant: ad.merchant.isMerchant,
          userIdentity: ad.merchant.userIdentity,
          vipLevel: ad.merchant.vipLevel,
        })
      : null;
  const d = other ? spreadBetween(other.price, ad.price) : null;
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        aria-pressed={picked}
        className={cn(
          "grid w-full grid-cols-[1.5rem_minmax(0,1fr)_auto] items-start gap-x-2 px-4 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/60 focus-visible:outline-none",
          picked && "bg-muted ring-1 ring-inset ring-ring",
        )}
      >
        <span className="pt-0.5 font-mono text-[11px] text-muted-foreground tabular-nums">{rank}</span>
        <span className="min-w-0 space-y-0.5">
          <span
            className={cn(
              "block font-mono text-sm font-semibold tabular-nums",
              ad.tradeType === "SELL" ? "text-[color:var(--color-buy)]" : "text-[color:var(--color-sell)]",
            )}
          >
            {formatFiat(ad.price, S, 2)}
          </span>
          <span className="flex min-w-0 items-center gap-1 text-xs">
            <span className="truncate">{ad.merchant.name}</span>
            <TierBadge tier={tier} />
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {formatPct(ad.merchant.completionRate, { frac: 1 })} · {formatInt(ad.merchant.orders30d)} orders ·{" "}
            {S} {formatCompact(ad.minOrder)}–{formatCompact(ad.maxOrder)}
          </span>
        </span>
        <span className="space-y-0.5 text-right">
          <span className="block font-mono text-xs tabular-nums">{formatCompact(ad.available)} USDT</span>
          <span className="block font-mono text-[11px] tabular-nums text-muted-foreground">
            {d ? `Δ ${formatSigned(d.abs, 2)}` : "Δ —"}
          </span>
          {d?.pct != null && (
            <span className="block font-mono text-[11px] tabular-nums text-muted-foreground">
              {formatPct(d.pct, { frac: 2, sign: true })}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

/* ── Pick-two spread ───────────────────────────────────────────────────── */

function PickSummary({
  picks,
  books,
  cfg,
  onClear,
}: {
  picks: (Pick & { gone: boolean })[];
  books: LiveBooks;
  cfg: Record<BookId, BookConfig>;
  onClear: () => void;
}) {
  const name = (p: Pick) => `${books[cfg[p.book].exchange]?.label ?? ""} · ${p.ad.merchant.name}`;

  if (picks.length < 2) {
    return (
      <Card className="flex-row items-center justify-between gap-3 px-4 py-3">
        <p className="text-xs text-muted-foreground">
          {picks.length === 0
            ? "Pick two ads (from either book) to see the spread between them."
            : `Picked ${formatFiat(picks[0].ad.price, S, 2)} (${name(picks[0])}). Pick one more.`}
        </p>
        {picks.length > 0 && (
          <Button variant="ghost" size="sm" onClick={onClear}>
            <X /> Clear
          </Button>
        )}
      </Card>
    );
  }

  const [p1, p2] = picks;
  // A sell ad (you buy) and a buy ad (you sell) form a round trip: the
  // spread is what you'd keep per USDT before fees.
  const roundTrip = p1.ad.tradeType !== p2.ad.tradeType;
  const buyLeg = roundTrip ? (p1.ad.tradeType === "SELL" ? p1 : p2) : p1;
  const sellLeg = roundTrip ? (p1.ad.tradeType === "SELL" ? p2 : p1) : p2;
  const s = spreadBetween(buyLeg.ad.price, sellLeg.ad.price);
  const positive = s.abs > 0;

  return (
    <Card className="gap-2 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1 text-xs">
          <div className="truncate">
            <span className="text-muted-foreground">{roundTrip ? "Buy from " : "Ad 1 "}</span>
            <span className="font-mono tabular-nums">{formatFiat(buyLeg.ad.price, S, 2)}</span>{" "}
            <span className="text-muted-foreground">{name(buyLeg)}</span>
            {buyLeg.gone && <span className="text-[color:var(--color-warn)]"> (gone)</span>}
          </div>
          <div className="truncate">
            <span className="text-muted-foreground">{roundTrip ? "Sell to " : "Ad 2 "}</span>
            <span className="font-mono tabular-nums">{formatFiat(sellLeg.ad.price, S, 2)}</span>{" "}
            <span className="text-muted-foreground">{name(sellLeg)}</span>
            {sellLeg.gone && <span className="text-[color:var(--color-warn)]"> (gone)</span>}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClear}>
          <X /> Clear
        </Button>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          className={cn(
            "font-mono text-xl font-semibold tabular-nums",
            roundTrip && (positive ? "text-[color:var(--color-buy)]" : "text-[color:var(--color-sell)]"),
          )}
        >
          {formatSigned(s.abs, 2)} {S}
        </span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {formatPct(s.pct, { frac: 3, sign: true })}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {roundTrip
            ? positive
              ? "per USDT before fees and transfer costs"
              : "per USDT: this round trip loses money"
            : "difference per USDT (ad 2 − ad 1)"}
        </span>
      </div>
    </Card>
  );
}
