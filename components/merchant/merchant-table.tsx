"use client";

import { useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowDown, ArrowUp, ArrowUpDown, ShieldCheck } from "lucide-react";
import type { MerchantSummary } from "@/lib/analytics";
import {
  formatCompact,
  formatDuration,
  formatFiat,
  formatPct,
} from "@/lib/format";
import { cn } from "@/lib/utils";

type SortKey =
  | "trustScore"
  | "orders30d"
  | "completionRate"
  | "totalAvailableFiat"
  | "premiumVsMedian"
  | "avgReleaseSec";

export function MerchantTable({
  merchants,
  symbol,
  asset,
}: {
  merchants: MerchantSummary[];
  symbol: string;
  asset: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("trustScore");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const list = [...merchants];
    list.sort((a, b) => {
      const av = (a[sortKey] ?? 0) as number;
      const bv = (b[sortKey] ?? 0) as number;
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return list;
  }, [merchants, sortKey, sortDir]);

  function toggle(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card/60 overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="w-[220px]">Merchant</TableHead>
              <TableHead className="text-right">
                <SortH
                  label="Trust"
                  active={sortKey === "trustScore"}
                  dir={sortDir}
                  onClick={() => toggle("trustScore")}
                />
              </TableHead>
              <TableHead className="text-right">
                <SortH
                  label="30d orders"
                  active={sortKey === "orders30d"}
                  dir={sortDir}
                  onClick={() => toggle("orders30d")}
                />
              </TableHead>
              <TableHead className="text-right">
                <SortH
                  label="Completion"
                  active={sortKey === "completionRate"}
                  dir={sortDir}
                  onClick={() => toggle("completionRate")}
                />
              </TableHead>
              <TableHead className="text-right">
                <SortH
                  label="Depth"
                  active={sortKey === "totalAvailableFiat"}
                  dir={sortDir}
                  onClick={() => toggle("totalAvailableFiat")}
                />
              </TableHead>
              <TableHead className="text-right">
                <SortH
                  label="Premium"
                  active={sortKey === "premiumVsMedian"}
                  dir={sortDir}
                  onClick={() => toggle("premiumVsMedian")}
                />
              </TableHead>
              <TableHead className="text-right">
                <SortH
                  label="Release"
                  active={sortKey === "avgReleaseSec"}
                  dir={sortDir}
                  onClick={() => toggle("avgReleaseSec")}
                />
              </TableHead>
              <TableHead>Rails</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  No merchants in this market right now.
                </TableCell>
              </TableRow>
            )}
            {sorted.map((m, i) => (
              <MerchantRow
                key={m.id}
                m={m}
                rank={i + 1}
                symbol={symbol}
                asset={asset}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function MerchantRow({
  m,
  rank,
  symbol,
  asset,
}: {
  m: MerchantSummary;
  rank: number;
  symbol: string;
  asset: string;
}) {
  return (
    <TableRow className="border-border transition-colors hover:bg-accent/40">
      <TableCell className="py-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground w-5 text-right">
            #{rank}
          </span>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted/50 font-mono text-[11px] font-medium text-muted-foreground">
            {(m.name || "?").slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium text-foreground">
                {m.name}
              </span>
              {m.isMerchant && (
                <ShieldCheck
                  className="h-3 w-3 shrink-0 text-primary"
                  strokeWidth={2}
                  aria-label="Verified merchant"
                />
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="font-mono tabular-nums">
                {m.adCount} ad{m.adCount === 1 ? "" : "s"}
              </span>
              <span>·</span>
              <span>
                {m.buyAds > 0 && (
                  <span className="text-[color:var(--color-buy)]">
                    {m.buyAds}B
                  </span>
                )}
                {m.buyAds > 0 && m.sellAds > 0 && (
                  <span className="text-muted-foreground/40"> / </span>
                )}
                {m.sellAds > 0 && (
                  <span className="text-[color:var(--color-sell)]">
                    {m.sellAds}S
                  </span>
                )}
              </span>
            </div>
          </div>
        </div>
      </TableCell>

      <TableCell className="py-3 text-right">
        <ScorePill value={m.trustScore} />
      </TableCell>

      <TableCell className="py-3 text-right font-mono text-sm tabular-nums text-foreground">
        {formatCompact(m.orders30d)}
      </TableCell>

      <TableCell className="py-3 text-right">
        <span
          className={cn(
            "font-mono text-sm tabular-nums",
            m.completionRate >= 0.97
              ? "text-[color:var(--color-buy)]"
              : m.completionRate >= 0.9
                ? "text-foreground"
                : "text-[color:var(--color-sell)]",
          )}
        >
          {formatPct(m.completionRate, { frac: 1 })}
        </span>
      </TableCell>

      <TableCell className="py-3 text-right font-mono text-sm tabular-nums text-muted-foreground">
        {formatFiat(m.totalAvailableFiat, symbol, 0)}
      </TableCell>

      <TableCell className="py-3 text-right">
        {m.premiumVsMedian == null ? (
          <span className="text-muted-foreground text-xs">—</span>
        ) : (
          <span
            className={cn(
              "font-mono text-[12px] tabular-nums",
              Math.abs(m.premiumVsMedian) < 0.001
                ? "text-muted-foreground"
                : m.premiumVsMedian > 0
                  ? "text-[color:var(--color-warn)]"
                  : "text-[color:var(--color-buy)]",
            )}
          >
            {formatPct(m.premiumVsMedian, { frac: 2, sign: true })}
          </span>
        )}
      </TableCell>

      <TableCell className="py-3 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
        {formatDuration(m.avgReleaseSec)}
      </TableCell>

      <TableCell className="py-3">
        <div className="flex flex-wrap gap-1">
          {m.payMethods.slice(0, 3).map((pm) => (
            <Badge
              key={pm}
              variant="secondary"
              className="bg-secondary/70 text-[10px] text-foreground/80"
            >
              {pm}
            </Badge>
          ))}
          {m.payMethods.length > 3 && (
            <Badge
              variant="outline"
              className="text-[10px] border-dashed text-muted-foreground"
            >
              +{m.payMethods.length - 3}
            </Badge>
          )}
        </div>
        <span className="sr-only">{asset}</span>
      </TableCell>
    </TableRow>
  );
}

function ScorePill({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  const tone =
    clamped >= 80
      ? "text-[color:var(--color-buy)] bg-[color:var(--color-buy-muted)]"
      : clamped >= 60
        ? "text-foreground bg-muted"
        : "text-[color:var(--color-sell)] bg-[color:var(--color-sell-muted)]";

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums",
        tone,
      )}
    >
      {Math.round(clamped)}
    </span>
  );
}

function SortH({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider transition-colors",
        active
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      <Icon className="h-3 w-3" strokeWidth={2} />
    </button>
  );
}
