"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink } from "lucide-react";
import { Sparkline } from "@/components/charts/sparkline";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { formatAmount, formatDay, formatRate, type CurrencyOption, type RateMatrix, type SourceView } from "./model";

export type BankHistoryRow = { source: string; type: string; day: string; value: number };

type Kind = "tt" | "cash";
type SortKey = "bank" | "buy" | "sell" | "spread";

type Row = {
  source: SourceView;
  buy: number | null;
  sell: number | null;
  spread: number | null;
  spreadPct: number | null;
  asOf: string | null;
  spark: number[];
  reference: boolean;
};

/**
 * Bank board rates for one currency: buying, selling, spread and a 14-day
 * sparkline of the buying rate. Sortable; a card list on phones.
 * The CBSL average TT row is shown as a reference (not ranked as "best").
 */
export function BankTable({
  matrix,
  sources,
  currencies,
  initialHistory,
}: {
  matrix: RateMatrix;
  sources: SourceView[];
  currencies: CurrencyOption[];
  initialHistory: { currency: string; rows: BankHistoryRow[] };
}) {
  const [currency, setCurrency] = useState(initialHistory.currency);
  const [kind, setKind] = useState<Kind>("tt");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "buy", dir: -1 });
  const [histories, setHistories] = useState<Record<string, BankHistoryRow[]>>({
    [initialHistory.currency]: initialHistory.rows,
  });
  const [loading, setLoading] = useState(false);

  function pickCurrency(c: string) {
    setCurrency(c);
    if (histories[c]) return;
    setLoading(true);
    fetch(`/api/rates/banks?currency=${encodeURIComponent(c)}&days=14`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<{ data: BankHistoryRow[] }>;
      })
      .then((j) => setHistories((h) => ({ ...h, [c]: j.data })))
      .catch(() => setHistories((h) => ({ ...h, [c]: [] })))
      .finally(() => setLoading(false));
  }

  const rows = useMemo(() => {
    const hist = histories[currency] ?? [];
    const out: Row[] = [];
    for (const s of sources) {
      const reference = s.kind === "central-bank";
      if (reference && (kind !== "tt" || s.id !== "cbsl_tt")) continue;
      const cells = matrix[s.id]?.[currency];
      const b = cells?.[kind === "tt" ? "tt_buy" : "cash_buy"];
      const se = cells?.[kind === "tt" ? "tt_sell" : "cash_sell"];
      if (!b && !se) continue;
      const buy = b?.v ?? null;
      const sell = se?.v ?? null;
      const spread = buy != null && sell != null ? sell - buy : null;
      const sparkType = kind === "tt" ? "tt_buy" : "cash_buy";
      out.push({
        source: s,
        buy,
        sell,
        spread,
        spreadPct: spread != null && buy != null && sell != null ? spread / ((buy + sell) / 2) : null,
        asOf: b?.d ?? se?.d ?? null,
        spark: hist.filter((h) => h.source === s.id && h.type === sparkType).map((h) => h.value),
        reference,
      });
    }
    const val = (r: Row) =>
      sort.key === "bank" ? r.source.shortName : sort.key === "buy" ? r.buy : sort.key === "sell" ? r.sell : r.spreadPct;
    return out.sort((a, b) => {
      if (a.reference !== b.reference) return a.reference ? 1 : -1;
      const va = val(a);
      const vb = val(b);
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "string" && typeof vb === "string") return va.localeCompare(vb) * sort.dir;
      return ((va as number) - (vb as number)) * sort.dir;
    });
  }, [matrix, sources, currency, kind, sort, histories]);

  const banks = rows.filter((r) => !r.reference);
  const bestBuy = Math.max(...banks.map((r) => r.buy ?? -Infinity));
  const bestSell = Math.min(...banks.map((r) => r.sell ?? Infinity));
  const latestDay = banks.reduce<string | null>((m, r) => (r.asOf && (!m || r.asOf > m) ? r.asOf : m), null);
  const curName = currencies.find((c) => c.code === currency)?.name ?? currency;

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "bank" ? 1 : key === "sell" || key === "spread" ? 1 : -1 }));
  }

  const sortHead = (k: SortKey, children: React.ReactNode, className?: string) => (
    <TableHead key={k} className={className} aria-sort={sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className={cn("inline-flex items-center gap-1 hover:text-foreground", className?.includes("text-right") && "flex-row-reverse")}
      >
        {children}
        {sort.key === k ? (
          sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
        ) : (
          <ArrowUpDown className="size-3 opacity-40" />
        )}
      </button>
    </TableHead>
  );

  const typeLabel = kind === "tt" ? "TT" : "Currency notes";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={currency} onValueChange={(v) => v && pickCurrency(String(v))}>
          <SelectTrigger
            className="w-44"
            aria-label={`Currency: ${currency} · ${currencies.find((c) => c.code === currency)?.name ?? ""}`}
          >
            <SelectValue>{(v) => `${v} · ${currencies.find((c) => c.code === v)?.name ?? ""}`}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {currencies.map((c) => (
              <SelectItem key={c.code} value={c.code}>
                <span className="font-mono text-xs">{c.code}</span> {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ToggleGroup
          value={[kind]}
          onValueChange={(v) => v[0] && setKind(v[0] as Kind)}
          variant="outline"
          size="sm"
          spacing={0}
          aria-label="Rate type"
        >
          <ToggleGroupItem value="tt" className="px-2.5 text-xs">
            TT
          </ToggleGroupItem>
          <ToggleGroupItem value="cash" className="px-2.5 text-xs">
            Notes
          </ToggleGroupItem>
        </ToggleGroup>
        <span className="text-xs text-muted-foreground">
          {banks.length} banks · LKR per 1 {currency}
          {latestDay ? ` · ${formatDay(latestDay)}` : ""}
          {loading ? " · loading trend…" : ""}
        </span>
      </div>

      {rows.length === 0 ? (
        <Card className="px-4 py-8 text-center text-sm text-muted-foreground">
          No bank publishes {typeLabel.toLowerCase()} rates for {curName} in our sources.
        </Card>
      ) : (
        <>
          {/* Desktop / tablet table */}
          <Card className="hidden overflow-hidden p-0 sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  {sortHead("bank", "Bank")}
                  {sortHead("buy", `${typeLabel} buying`, "text-right")}
                  {sortHead("sell", `${typeLabel} selling`, "text-right")}
                  {sortHead("spread", "Spread", "text-right")}
                  <TableHead className="w-32">14-day buying</TableHead>
                  <TableHead className="text-right">As of</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.source.id} className={cn(r.reference && "bg-muted/40")}>
                    <TableCell className="font-medium">
                      <a
                        href={r.source.pageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 hover:underline"
                      >
                        {r.reference ? "CBSL average" : r.source.shortName}
                        <ExternalLink className="size-3 text-muted-foreground" />
                      </a>
                      {r.reference && <div className="text-[11px] font-normal text-muted-foreground">Reference, 9:30 AM bank quotes</div>}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-mono tabular-nums",
                        !r.reference && r.buy === bestBuy && banks.length > 1 && "font-semibold text-[color:var(--color-buy)]",
                      )}
                    >
                      {formatRate(r.buy)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-mono tabular-nums",
                        !r.reference && r.sell === bestSell && banks.length > 1 && "font-semibold text-[color:var(--color-sell)]",
                      )}
                    >
                      {formatRate(r.sell)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {r.spread != null ? `${formatAmount(r.spread, r.spread >= 1 ? 2 : 4)} · ${(r.spreadPct! * 100).toFixed(2)}%` : "—"}
                    </TableCell>
                    <TableCell className="py-1">
                      {r.spark.length > 1 ? (
                        <Sparkline values={r.spark} tone="neutral" className="h-7" label={`${r.source.shortName} ${currency} buying, 14 days`} />
                      ) : (
                        <span className="text-[11px] text-muted-foreground">{r.spark.length === 1 ? "1 day so far" : "—"}</span>
                      )}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right text-xs tabular-nums",
                        r.asOf && latestDay && r.asOf < latestDay ? "text-[color:var(--color-warn)]" : "text-muted-foreground",
                      )}
                    >
                      {formatDay(r.asOf, true)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* Phone card list */}
          <div className="space-y-2 sm:hidden">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Sort:
              {(["buy", "sell", "spread", "bank"] as SortKey[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => toggleSort(k)}
                  className={cn(
                    "rounded-md border px-2 py-1",
                    sort.key === k ? "border-foreground/30 text-foreground" : "border-border",
                  )}
                >
                  {k === "buy" ? "Buying" : k === "sell" ? "Selling" : k === "spread" ? "Spread" : "Bank"}
                  {sort.key === k ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
                </button>
              ))}
            </div>
            {rows.map((r) => (
              <Card key={r.source.id} className={cn("gap-2 px-4 py-3", r.reference && "bg-muted/40")}>
                <div className="flex items-center justify-between gap-2">
                  <a href={r.source.pageUrl} target="_blank" rel="noopener noreferrer" className="truncate text-sm font-medium">
                    {r.reference ? "CBSL average (reference)" : r.source.name}
                  </a>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{formatDay(r.asOf, true)}</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <div className="text-[11px] text-muted-foreground">Buying</div>
                    <div
                      className={cn(
                        "font-mono text-sm tabular-nums",
                        !r.reference && r.buy === bestBuy && banks.length > 1 && "font-semibold text-[color:var(--color-buy)]",
                      )}
                    >
                      {formatRate(r.buy)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-muted-foreground">Selling</div>
                    <div
                      className={cn(
                        "font-mono text-sm tabular-nums",
                        !r.reference && r.sell === bestSell && banks.length > 1 && "font-semibold text-[color:var(--color-sell)]",
                      )}
                    >
                      {formatRate(r.sell)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-muted-foreground">Spread</div>
                    <div className="font-mono text-sm tabular-nums text-muted-foreground">
                      {r.spreadPct != null ? `${(r.spreadPct * 100).toFixed(2)}%` : "—"}
                    </div>
                  </div>
                </div>
                {r.spark.length > 1 && <Sparkline values={r.spark} tone="neutral" className="h-6" label={`${r.source.shortName} trend`} />}
              </Card>
            ))}
          </div>
        </>
      )}
      <p className="text-[11px] text-muted-foreground">
        Buying = what the bank pays you per {currency}; selling = what it charges. Highlighted: best buying (highest) and best
        selling (lowest) among banks. Dates in amber are older than the latest board — that bank hasn&apos;t updated yet.
      </p>
    </div>
  );
}
