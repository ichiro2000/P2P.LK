"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
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
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ExternalLink,
} from "lucide-react";
import { MerchantStar } from "@/components/workspace/star-button";
import { TierBadge } from "@/components/merchant/tier-badge";
import { deriveMerchantTier } from "@/lib/merchant-tier";
import type { MerchantRow } from "@/lib/analytics";
import {
  formatCompact,
  formatDuration,
  formatFiat,
  formatPct,
  formatRelative,
} from "@/lib/format";
import { cn } from "@/lib/utils";

type SortKey =
  | "trustScore"
  | "orders30d"
  | "completionRate"
  | "totalAvailableFiat"
  | "premiumVsMedian"
  | "avgReleaseSec"
  | "lastSeenTs";

/** Build the Bybit public advertiser URL.
 *  `id` here is Bybit's `userMaskId` (the `s...` token), which is what their
 *  profile route uses — the numeric `userId` shown in API responses doesn't
 *  resolve in the public URL. */
function bybitAdvertiserUrl(id: string, asset: string, fiat: string): string {
  return `https://www.bybit.com/en/p2p/profile/${encodeURIComponent(
    id,
  )}/${encodeURIComponent(asset)}/${encodeURIComponent(fiat)}/item`;
}

/** Compact the Bybit pay-method labels for a narrow badge. */
function shortPayRail(name: string): string {
  if (/\(\s*sri lanka\s*\)/i.test(name)) return "LK Bank";
  if (/^bank transfer/i.test(name)) return "Bank";
  if (/^trans\s*bank/i.test(name)) return "Trans Bank";
  return name;
}

export function MerchantTable({
  merchants,
  symbol,
  asset,
  fiat,
}: {
  merchants: MerchantRow[];
  symbol: string;
  asset: string;
  fiat: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("trustScore");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const list = [...merchants];
    list.sort((a, b) => {
      // Keep active merchants above inactive when ranking by trust; that's the
      // most common case and matches user expectation.
      if (sortKey === "trustScore" && a.isActive !== b.isActive) {
        return a.isActive ? -1 : 1;
      }
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
              <TableHead className="w-[200px]">Merchant</TableHead>
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
              <TableHead className="hidden text-right xl:table-cell">
                <SortH
                  label="Release"
                  active={sortKey === "avgReleaseSec"}
                  dir={sortDir}
                  onClick={() => toggle("avgReleaseSec")}
                />
              </TableHead>
              <TableHead className="hidden text-right xl:table-cell">
                <SortH
                  label="Last seen"
                  active={sortKey === "lastSeenTs"}
                  dir={sortDir}
                  onClick={() => toggle("lastSeenTs")}
                />
              </TableHead>
              <TableHead className="hidden lg:table-cell">Rails</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  No merchants in this market right now.
                </TableCell>
              </TableRow>
            )}
            {sorted.map((m, i) => (
              <MerchantRowCmp
                key={m.id}
                m={m}
                rank={i + 1}
                symbol={symbol}
                asset={asset}
                fiat={fiat}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function MerchantRowCmp({
  m,
  rank,
  symbol,
  asset,
  fiat,
}: {
  m: MerchantRow;
  rank: number;
  symbol: string;
  asset: string;
  fiat: string;
}) {
  return (
    <TableRow
      className={cn(
        "border-border transition-colors hover:bg-accent/40",
        !m.isActive && "opacity-70",
      )}
    >
      <TableCell className="py-3">
        <div className="flex max-w-[240px] items-center gap-2 min-w-0">
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground w-5 text-right shrink-0">
            #{rank}
          </span>
          <div className="relative shrink-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-muted/50 font-mono text-[11px] font-medium text-muted-foreground">
              {(m.name || "?").slice(0, 2).toUpperCase()}
            </div>
            <span
              aria-hidden
              className={cn(
                "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-card",
                m.isActive
                  ? "bg-[color:var(--color-buy)]"
                  : "bg-muted-foreground/40",
              )}
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <Link
                href={`/merchants/${encodeURIComponent(m.id)}`}
                className="min-w-0 truncate text-sm font-medium text-foreground hover:text-primary"
                title={`Open ${m.name} detail`}
              >
                <span className="truncate">{m.name}</span>
              </Link>
              <a
                href={bybitAdvertiserUrl(m.id, asset, fiat)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-primary"
                aria-label={`Open ${m.name} on Bybit`}
                title={`Open ${m.name} on Bybit`}
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="h-3 w-3" strokeWidth={2} />
              </a>
              <TierBadge
                tier={deriveMerchantTier({
                  isMerchant: m.isMerchant,
                  userIdentity: m.userIdentity,
                  vipLevel: m.vipLevel,
                })}
                size="xs"
              />
              {!m.isActive && (
                <Badge
                  variant="outline"
                  className="h-4 border-dashed px-1 text-[9px] font-medium uppercase tracking-wide text-muted-foreground"
                >
                  offline
                </Badge>
              )}
              <MerchantStar
                id={m.id}
                name={m.name}
                asset={asset}
                fiat={fiat}
                className="-mr-1"
              />
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="font-mono tabular-nums">
                {m.adCount} ad{m.adCount === 1 ? "" : "s"}
              </span>
              {(m.buyAds > 0 || m.sellAds > 0) && (
                <>
                  <span>·</span>
                  <span>
                    {/* BUY-type ads (merchant bidding) = retail sell context → red.
                        SELL-type ads (merchant offering) = retail buy context → green. */}
                    {m.buyAds > 0 && (
                      <span className="text-[color:var(--color-sell)]">
                        {m.buyAds}B
                      </span>
                    )}
                    {m.buyAds > 0 && m.sellAds > 0 && (
                      <span className="text-muted-foreground/40"> / </span>
                    )}
                    {m.sellAds > 0 && (
                      <span className="text-[color:var(--color-buy)]">
                        {m.sellAds}S
                      </span>
                    )}
                  </span>
                </>
              )}
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

      <TableCell className="hidden py-3 text-right font-mono text-[12px] tabular-nums text-muted-foreground xl:table-cell">
        {formatDuration(m.avgReleaseSec)}
      </TableCell>

      <TableCell className="hidden py-3 text-right text-[12px] text-muted-foreground xl:table-cell">
        {m.isActive ? (
          <span className="font-mono text-[color:var(--color-buy)]">now</span>
        ) : (
          <span className="font-mono tabular-nums">
            {formatRelative(new Date(m.lastSeenTs * 1000))}
          </span>
        )}
      </TableCell>

      <TableCell className="hidden py-3 lg:table-cell">
        <div className="flex flex-wrap gap-1">
          {m.payMethods.slice(0, 2).map((pm) => (
            <Badge
              key={pm}
              variant="secondary"
              className="bg-secondary/70 text-[10px] text-foreground/80"
              title={pm}
            >
              {shortPayRail(pm)}
            </Badge>
          ))}
          {m.payMethods.length > 2 && (
            <Badge
              variant="outline"
              className="text-[10px] border-dashed text-muted-foreground"
              title={m.payMethods.slice(2).join(", ")}
            >
              +{m.payMethods.length - 2}
            </Badge>
          )}
          {m.payMethods.length === 0 && (
            <span className="text-[10px] text-muted-foreground/60">—</span>
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
