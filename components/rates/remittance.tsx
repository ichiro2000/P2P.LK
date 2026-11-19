"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatAmount, formatDay, formatRate, type RateMatrix, type SourceView } from "./model";
import { usePolling } from "@/hooks/use-polling";
import { walkBook, type WalkResult } from "@/lib/liquidity";
import type { BooksPayload } from "@/lib/compare";

export type P2PBid = { exchange: string; label: string; bid: number | null };

/**
 * Remittance route finder (PLAN 6b.10): compares sending foreign currency
 * home through a bank TT against buying USDT abroad and selling it on the
 * LKR P2P market. Every assumption is shown and the USDT cost is editable,
 * because we don't track foreign-currency → USDT prices.
 */
export function RemittanceFinder({
  matrix,
  sources,
  p2p,
  currencyNames,
}: {
  matrix: RateMatrix;
  sources: SourceView[];
  p2p: P2PBid[];
  currencyNames: Record<string, string>;
}) {
  const banks = sources.filter((s) => s.kind === "bank");
  const cbsl = matrix.cbsl ?? {};
  const usdInd = cbsl.USD?.indicative?.v ?? null;
  const currencies = Object.keys(cbsl)
    .filter((c) => cbsl[c]?.indicative && banks.some((b) => matrix[b.id]?.[c]?.tt_buy))
    .sort((a, b) => a.localeCompare(b));

  const [currency, setCurrency] = useState(currencies.includes("AED") ? "AED" : (currencies[0] ?? "USD"));
  const [amount, setAmount] = useState("1000");
  const [feePct, setFeePct] = useState("1.0");

  const amt = Number(amount.replace(/,/g, ""));
  const fee = Number(feePct);
  const valid = Number.isFinite(amt) && amt > 0 && Number.isFinite(fee) && fee >= 0 && fee < 20;

  // Route A: best bank TT buying rate for this currency.
  let bank: { name: string; pageUrl: string; rate: number; day: string } | null = null;
  for (const b of banks) {
    const c = matrix[b.id]?.[currency]?.tt_buy;
    if (c && (!bank || c.v > bank.rate)) bank = { name: b.name, pageUrl: b.pageUrl, rate: c.v, day: c.d };
  }
  const viaBank = valid && bank ? amt * bank.rate : null;

  // Route B: currency → USD at the CBSL cross rate, minus the USDT purchase
  // cost, then sell that USDT into the P2P buy ads — walked across the book
  // with the shared walk (F26), not priced at the single best ad.
  const curInd = cbsl[currency]?.indicative?.v ?? null;
  const cross = curInd != null && usdInd ? curInd / usdInd : null;
  const usdt = valid && cross != null ? amt * cross * (1 - fee / 100) : null;
  const { data: booksData } = usePolling<BooksPayload>("/api/compare?view=books", { intervalMs: 60_000 });
  let route: { label: string; walk: WalkResult | null; lkr: number } | null = null;
  if (usdt != null && usdt > 0) {
    if (booksData) {
      for (const book of Object.values(booksData.books)) {
        if (!book.ok) continue;
        const walk = walkBook(book.buy, "BUY", usdt, { unit: "asset" });
        if (walk.effectivePrice == null) continue;
        // Unfilled USDT isn't converted, so compare on fully filled books first.
        const better =
          !route ||
          (route.walk?.partial && !walk.partial) ||
          (Boolean(route.walk?.partial) === walk.partial && walk.filledFiat > route.lkr);
        if (better) route = { label: book.label, walk, lkr: walk.filledFiat };
      }
    } else {
      // Books still loading: best single bid, labelled as such below.
      const top = p2p.reduce<P2PBid | null>((m, q) => (q.bid != null && (!m || q.bid > (m.bid ?? 0)) ? q : m), null);
      if (top?.bid != null) route = { label: top.label, walk: null, lkr: usdt * top.bid };
    }
  }
  const viaUsdt = route?.lkr ?? null;

  const diff = viaBank != null && viaUsdt != null ? viaUsdt - viaBank : null;
  const winner = diff == null ? null : diff > 0 ? "usdt" : "bank";

  return (
    <Card className="gap-4 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="rem-currency">You send</Label>
          <Select value={currency} onValueChange={(v) => v && setCurrency(String(v))}>
            <SelectTrigger id="rem-currency" className="w-full">
              <SelectValue>{(v) => `${v} · ${currencyNames[String(v)] ?? ""}`}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {currencies.map((c) => (
                <SelectItem key={c} value={c}>
                  <span className="font-mono text-xs">{c}</span> {currencyNames[c] ?? ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rem-amount">Amount ({currency})</Label>
          <Input
            id="rem-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="font-mono tabular-nums"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rem-fee">Cost to buy USDT abroad (%)</Label>
          <Input
            id="rem-fee"
            inputMode="decimal"
            value={feePct}
            onChange={(e) => setFeePct(e.target.value)}
            className="font-mono tabular-nums"
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className={cn("rounded-lg border p-4", winner === "bank" && "border-[color:var(--color-buy)]")}>
          <div className="text-xs text-muted-foreground">Route A · bank TT</div>
          <div className="font-mono text-xl font-semibold tabular-nums">{viaBank != null ? `Rs ${formatAmount(viaBank, 0)}` : "—"}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {bank ? (
              <>
                {currency} → LKR at {formatRate(bank.rate)} (best TT buying,{" "}
                <a href={bank.pageUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                  {bank.name}
                </a>
                , {formatDay(bank.day, true)})
              </>
            ) : (
              "No bank TT rate for this currency."
            )}
          </div>
        </div>
        <div className={cn("rounded-lg border p-4", winner === "usdt" && "border-[color:var(--color-buy)]")}>
          <div className="text-xs text-muted-foreground">Route B · {currency} → USDT → LKR (P2P)</div>
          <div className="font-mono text-xl font-semibold tabular-nums">{viaUsdt != null ? `Rs ${formatAmount(viaUsdt, 0)}` : "—"}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {usdt != null && route ? (
              route.walk ? (
                <>
                  ≈ {formatAmount(usdt)} USDT sold across {route.walk.adsConsumed} buy ad
                  {route.walk.adsConsumed === 1 ? "" : "s"} on {route.label}, avg {formatRate(route.walk.effectivePrice ?? 0)}
                  {route.walk.partial && (
                    <span className="block text-[color:var(--color-warn)]">
                      Only {formatAmount(route.walk.filledAsset)} USDT fills on the visible book; the rest isn&apos;t
                      counted.
                    </span>
                  )}
                </>
              ) : (
                <>≈ {formatAmount(usdt)} USDT at the best {route.label} buy ad (loading the full book…)</>
              )
            ) : (
              "P2P price or CBSL cross rate unavailable."
            )}
          </div>
        </div>
      </div>

      {diff != null && viaBank != null && (
        <div className="text-sm">
          {winner === "usdt" ? "The USDT route gives" : "The bank route gives"}{" "}
          <span className="font-mono font-semibold tabular-nums">Rs {formatAmount(Math.abs(diff), 0)}</span> more (
          {((Math.abs(diff) / viaBank) * 100).toFixed(2)}%) under these assumptions.
        </div>
      )}

      <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
        <li>
          {currency} → USD uses the CBSL indicative cross rate ({cross != null ? cross.toFixed(4) : "—"} USD per {currency}); we
          don&apos;t track {currency}/USDT prices, so the real rate abroad may differ.
        </li>
        <li>1 USDT is treated as 1 USD, minus the purchase cost you enter above (exchange fees, spread, transfer).</li>
        <li>
          P2P walks the visible buy ads from the best price down, one order per ad, within each ad&apos;s limits, skipping
          offline and restricted advertisers. P2P carries counterparty and bank-freeze risk that a bank transfer
          doesn&apos;t.
        </li>
        <li>Bank route excludes the sender&apos;s fees abroad and any receiving-bank charges.</li>
      </ul>
    </Card>
  );
}
