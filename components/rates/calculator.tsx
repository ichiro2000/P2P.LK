"use client";

import { useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatAmount, formatDay, formatRate, type Cell, type RateMatrix, type RateType, type SourceView } from "./model";

type Dir = "toLkr" | "fromLkr";
type Kind = "tt" | "cash";

/** Which rate a source uses for a direction: the bank BUYS your foreign
 *  currency when you convert to LKR, and SELLS it when you buy it with LKR. */
function rateFor(sourceId: string, cells: Partial<Record<RateType, Cell>> | undefined, dir: Dir, kind: Kind) {
  if (!cells) return null;
  if (sourceId === "cbsl") return cells.indicative ? { cell: cells.indicative, label: "indicative" } : null;
  const type: RateType = `${kind === "cash" ? "cash" : "tt"}_${dir === "toLkr" ? "buy" : "sell"}`;
  const cell = cells[type];
  return cell ? { cell, label: `${kind === "cash" ? "notes" : "TT"} ${dir === "toLkr" ? "buying" : "selling"}` } : null;
}

export function RateCalculator({
  matrix,
  sources,
  currencyNames,
}: {
  matrix: RateMatrix;
  sources: SourceView[];
  currencyNames: Record<string, string>;
}) {
  const [sourceId, setSourceId] = useState("cbsl");
  const [currency, setCurrency] = useState("USD");
  const [dir, setDir] = useState<Dir>("toLkr");
  const [kind, setKind] = useState<Kind>("tt");
  const [amount, setAmount] = useState("1000");

  const source = sources.find((s) => s.id === sourceId) ?? sources[0];
  const available = Object.keys(matrix[sourceId] ?? {}).sort((a, b) => (a === "USD" ? -1 : b === "USD" ? 1 : a.localeCompare(b)));
  const cells = matrix[sourceId]?.[currency];
  const hasCash = !!(cells?.cash_buy || cells?.cash_sell);
  const effKind: Kind = kind === "cash" && !hasCash ? "tt" : kind;
  const picked = rateFor(sourceId, cells, dir, effKind);

  const amt = Number(amount.replace(/,/g, ""));
  const valid = Number.isFinite(amt) && amt > 0;
  const result = picked && valid ? (dir === "toLkr" ? amt * picked.cell.v : amt / picked.cell.v) : null;

  // Best bank for the same conversion (highest LKR out / most currency out).
  let best: { name: string; result: number } | null = null;
  if (valid) {
    for (const s of sources) {
      if (s.kind !== "bank") continue;
      const p = rateFor(s.id, matrix[s.id]?.[currency], dir, effKind);
      if (!p) continue;
      const r = dir === "toLkr" ? amt * p.cell.v : amt / p.cell.v;
      if (!best || r > best.result) best = { name: s.shortName, result: r };
    }
  }

  function pickSource(id: string) {
    setSourceId(id);
    if (!matrix[id]?.[currency]) setCurrency(matrix[id]?.USD ? "USD" : (Object.keys(matrix[id] ?? {})[0] ?? "USD"));
  }

  const from = dir === "toLkr" ? currency : "LKR";
  const to = dir === "toLkr" ? "LKR" : currency;

  return (
    <Card className="gap-4 p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="calc-source">Rate from</Label>
          <Select value={sourceId} onValueChange={(v) => v && pickSource(String(v))}>
            <SelectTrigger id="calc-source" className="w-full">
              <SelectValue>{(v) => sources.find((s) => s.id === v)?.name ?? "Source"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {sources.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.id === "cbsl" ? "CBSL indicative" : s.id === "cbsl_tt" ? "CBSL average TT" : s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="calc-currency">Currency</Label>
          <Select value={currency} onValueChange={(v) => v && setCurrency(String(v))}>
            <SelectTrigger id="calc-currency" className="w-full">
              <SelectValue>{(v) => `${v} · ${currencyNames[String(v)] ?? ""}`}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {available.map((c) => (
                <SelectItem key={c} value={c}>
                  <span className="font-mono text-xs">{c}</span> {currencyNames[c] ?? ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="calc-amount">Amount in {from}</Label>
          <Input
            id="calc-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={!valid}
            className="font-mono tabular-nums"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Direction</Label>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 flex-1 justify-center gap-1.5 font-mono text-xs"
              onClick={() => setDir((d) => (d === "toLkr" ? "fromLkr" : "toLkr"))}
              title="Swap direction"
            >
              {from} <ArrowLeftRight className="size-3.5" aria-hidden /> <span className="sr-only">to</span> {to}
              <span className="sr-only">, swap direction</span>
            </Button>
            {sourceId !== "cbsl" && sourceId !== "cbsl_tt" && (
              <ToggleGroup
                value={[effKind]}
                onValueChange={(v) => v[0] && setKind(v[0] as Kind)}
                variant="outline"
                size="sm"
                spacing={0}
                aria-label="Rate type"
              >
                <ToggleGroupItem value="tt" className="px-2 text-xs">
                  TT
                </ToggleGroupItem>
                <ToggleGroupItem value="cash" className="px-2 text-xs" disabled={!hasCash}>
                  Notes
                </ToggleGroupItem>
              </ToggleGroup>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-muted/30 p-4">
        <div className="text-xs text-muted-foreground">
          {valid ? `${formatAmount(amt)} ${from} =` : "Enter an amount"}
        </div>
        <div className="font-mono text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">
          {result != null ? `${formatAmount(result)} ${to}` : "—"}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {picked ? (
            <>
              Rate {formatRate(picked.cell.v)} LKR per {currency} ({picked.label}) · Source:{" "}
              <a href={source.pageUrl} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
                {source.name}
              </a>
              , as of {formatDay(picked.cell.d)}
            </>
          ) : (
            `${source.shortName} doesn't publish this rate for ${currency}.`
          )}
        </div>
        {best && sourceId !== "cbsl" && result != null && (
          <div className="mt-2 text-xs">
            Best bank for this today: <span className="font-medium">{best.name}</span>{" "}
            <span className="font-mono tabular-nums">
              {formatAmount(best.result)} {to}
            </span>
            {best.result - result > 0.005 && (
              <span className="text-muted-foreground"> (+{formatAmount(best.result - result)})</span>
            )}
          </div>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Indicative only. Banks charge commissions and may quote a better rate for large amounts — confirm with the bank before
        you transact.
      </p>
    </Card>
  );
}
