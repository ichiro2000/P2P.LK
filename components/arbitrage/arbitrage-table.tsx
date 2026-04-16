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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Info,
  ShieldAlert,
} from "lucide-react";
import type { MarketSnapshot } from "@/lib/types";
import { withinMarketArbitrage, type ArbitrageRow } from "@/lib/analytics";
import { formatCompact, formatFiat, formatPct } from "@/lib/format";
import { FIATS } from "@/lib/constants";
import { cn } from "@/lib/utils";

type SortKey = "netPct" | "grossPct" | "liquidityScore" | "riskScore";
type SortDir = "asc" | "desc";

export function ArbitrageTable({
  snapshots,
  feePct,
  slipPct,
}: {
  snapshots: MarketSnapshot[];
  feePct: number;
  slipPct: number;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("netPct");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const rows = useMemo(() => {
    const r = withinMarketArbitrage(snapshots, feePct, slipPct);
    const sign = sortDir === "asc" ? 1 : -1;
    return r.sort((a, b) => (a[sortKey] - b[sortKey]) * sign);
  }, [snapshots, feePct, slipPct, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
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
              <TableHead className="w-[140px]">Market</TableHead>
              <TableHead className="text-right">Buy at</TableHead>
              <TableHead className="text-right">Sell at</TableHead>
              <TableHead className="text-right">
                <SortHeader
                  label="Gross"
                  active={sortKey === "grossPct"}
                  dir={sortDir}
                  onClick={() => toggleSort("grossPct")}
                />
              </TableHead>
              <TableHead className="text-right">
                <SortHeader
                  label="Net"
                  active={sortKey === "netPct"}
                  dir={sortDir}
                  onClick={() => toggleSort("netPct")}
                  tooltip={`After assumed ${(feePct * 100).toFixed(2)}% fee + ${(slipPct * 100).toFixed(2)}% slippage`}
                />
              </TableHead>
              <TableHead className="text-right">Depth</TableHead>
              <TableHead className="text-right">
                <SortHeader
                  label="Liquidity"
                  active={sortKey === "liquidityScore"}
                  dir={sortDir}
                  onClick={() => toggleSort("liquidityScore")}
                />
              </TableHead>
              <TableHead className="text-right">
                <SortHeader
                  label="Risk"
                  active={sortKey === "riskScore"}
                  dir={sortDir}
                  onClick={() => toggleSort("riskScore")}
                />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  No markets reachable right now.
                </TableCell>
              </TableRow>
            )}
            {rows.map((row, i) => (
              <ArbRow key={`${row.asset}-${row.buyFiat}`} row={row} rank={i + 1} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function ArbRow({ row, rank }: { row: ArbitrageRow; rank: number }) {
  const fiat = FIATS.find((f) => f.code === row.buyFiat);
  const symbol = fiat?.symbol ?? row.buyFiat;

  const netTone =
    row.netPct > 0.005
      ? "text-[color:var(--color-buy)]"
      : row.netPct < -0.005
        ? "text-[color:var(--color-sell)]"
        : "text-foreground";

  return (
    <TableRow className="border-border transition-colors hover:bg-accent/40">
      <TableCell className="py-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground w-5 text-right">
            #{rank}
          </span>
          <span className="text-base">{fiat?.flag ?? "🏳"}</span>
          <div className="flex flex-col">
            <span className="font-mono text-sm font-medium text-foreground">
              {row.asset}/{row.buyFiat}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {fiat?.name}
            </span>
          </div>
        </div>
      </TableCell>

      <TableCell className="py-3 text-right">
        <div className="font-mono text-sm tabular-nums text-[color:var(--color-sell)]">
          {formatFiat(row.buyPrice, symbol, 2)}
        </div>
      </TableCell>

      <TableCell className="py-3 text-right">
        <div className="font-mono text-sm tabular-nums text-[color:var(--color-buy)]">
          {formatFiat(row.sellPrice, symbol, 2)}
        </div>
      </TableCell>

      <TableCell className="py-3 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
        {formatPct(row.grossPct, { frac: 2, sign: true })}
      </TableCell>

      <TableCell className="py-3 text-right">
        <div
          className={cn(
            "font-mono text-sm font-semibold tabular-nums",
            netTone,
          )}
        >
          {formatPct(row.netPct, { frac: 2, sign: true })}
        </div>
      </TableCell>

      <TableCell className="py-3 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
        {formatCompact(row.depth)} {row.asset}
      </TableCell>

      <TableCell className="py-3 text-right">
        <ScoreBar value={row.liquidityScore} tone="buy" />
      </TableCell>

      <TableCell className="py-3 text-right">
        <ScoreBar value={row.riskScore} tone="sell" />
      </TableCell>
    </TableRow>
  );
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
  tooltip,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  tooltip?: string;
}) {
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  const btn = (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider transition-colors",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span>{label}</span>
      <Icon className="h-3 w-3" strokeWidth={2} />
    </button>
  );
  if (!tooltip) return btn;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex items-center gap-1">
            {btn}
            <Info
              className="h-3 w-3 text-muted-foreground/50"
              strokeWidth={1.75}
            />
          </span>
        }
      />
      <TooltipContent side="top" className="max-w-[200px] text-[11px]">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

function ScoreBar({
  value,
  tone,
}: {
  value: number;
  tone: "buy" | "sell";
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="inline-flex items-center justify-end gap-2">
      <div className="h-1 w-12 overflow-hidden rounded-full bg-muted/50">
        <div
          className={cn(
            "h-full rounded-full",
            tone === "buy"
              ? "bg-[color:var(--color-buy)]"
              : "bg-[color:var(--color-sell)]",
          )}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="font-mono text-[11px] tabular-nums text-muted-foreground w-6 text-right">
        {Math.round(clamped)}
      </span>
    </div>
  );
}

export function ArbRiskBadge({ row }: { row: ArbitrageRow }) {
  if (row.riskScore < 40) return null;
  return (
    <Badge
      variant="outline"
      className="border-[color:var(--color-sell)]/30 bg-[color:var(--color-sell)]/10 text-[10px] text-[color:var(--color-sell)]"
    >
      <ShieldAlert className="h-3 w-3 mr-1" strokeWidth={2} />
      High risk
    </Badge>
  );
}
