"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, ExternalLink } from "lucide-react";
import { getExchange, type ExchangeId } from "@/lib/exchanges";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MerchantStar } from "@/components/workspace/star-button";
import { TierBadge } from "@/components/merchant/tier-badge";
import { ShowcaseBadge } from "@/components/merchant/showcase-badge";
import { deriveMerchantTier } from "@/lib/merchant-tier";
import type { MerchantRow } from "@/lib/analytics";
import type { ShowcaseMap } from "@/lib/market-insights";
import { ASSET, FIAT } from "@/lib/constants";
import { formatCompact, formatPct, formatRelative, formatCount } from "@/lib/format";
import { ReliabilityInfo } from "@/components/merchant/reliability-info";
import { cn } from "@/lib/utils";
import { InfoPopover } from "@/components/common/info-popover";
import { OwnSpreadText, SpreadMedianText } from "@/components/merchant/own-spread";
import { ownSpread, type SpreadMedian } from "@/lib/competitors";

type SortKey =
  | "trustScore"
  | "orders30d"
  | "completionRate"
  | "totalAvailableFiat"
  | "askVsBest"
  | "bidVsBest"
  | "ownSpread"
  | "avgReleaseSec"
  | "positiveRate"
  | "registerDays"
  | "lastSeenTs";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "trustScore", label: "Reliability" },
  { key: "orders30d", label: "30d orders" },
  { key: "completionRate", label: "Completion" },
  { key: "totalAvailableFiat", label: "Depth" },
  { key: "askVsBest", label: "Ask vs best" },
  { key: "bidVsBest", label: "Bid vs best" },
  { key: "ownSpread", label: "Own spread" },
  { key: "avgReleaseSec", label: "Release" },
  { key: "positiveRate", label: "Feedback" },
  { key: "registerDays", label: "Account age" },
  { key: "lastSeenTs", label: "Last seen" },
];
/** Gaps and release time: smaller is better, so they sort ascending first. */
const ASC_FIRST: SortKey[] = ["askVsBest", "bidVsBest", "ownSpread", "avgReleaseSec"];
/** Columns from the Binance profile (hidden below xl to keep the table readable). */
const PROFILE_COLS: SortKey[] = ["avgReleaseSec", "positiveRate", "registerDays"];

const PAGE = 50;

/** Directory row plus its own spread in LKR (null unless listing both sides now). */
type Row = MerchantRow & { ownSpread: number | null };
const sym = FIAT.symbol;

export function MerchantTable({
  merchants,
  exchange,
  showcase,
  spreadMedian,
}: {
  merchants: MerchantRow[];
  exchange: ExchangeId;
  showcase: ShowcaseMap;
  spreadMedian: SpreadMedian | null;
}) {
  const adapter = getExchange(exchange);
  const [sortKey, setSortKey] = useState<SortKey>("trustScore");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [limit, setLimit] = useState(PAGE);

  const sorted = useMemo(() => {
    const list: Row[] = merchants.map((m) => ({
      ...m,
      ownSpread: m.isActive ? (ownSpread(m.bestSellPrice, m.bestBuyPrice)?.lkr ?? null) : null,
    }));
    list.sort((a, b) => {
      // Active merchants stay above offline ones when ranking by score.
      if (sortKey === "trustScore" && a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      const av = a[sortKey];
      const bv = b[sortKey];
      // Unknown values (no ad on that side, no 30d count) always go last.
      if (av == null || bv == null) return av == null ? (bv == null ? 0 : 1) : -1;
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return list;
  }, [merchants, sortKey, sortDir]);
  const visible = sorted.slice(0, limit);

  function toggle(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(ASC_FIRST.includes(key) ? "asc" : "desc");
    }
  }

  const profile = (id: string) => adapter.profileUrl(id, ASSET, FIAT.code);

  return (
    <Card className="gap-0 py-0">
      {/* Phones: sort picker above the card list. */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3 md:hidden">
        <span className="text-xs text-muted-foreground">Sort by</span>
        <Select
          value={sortKey}
          onValueChange={(v) => {
            if (!v) return;
            setSortKey(v as SortKey);
            setSortDir(ASC_FIRST.includes(v as SortKey) ? "asc" : "desc");
          }}
        >
          <SelectTrigger className="h-10 flex-1 data-[size=default]:h-10" aria-label="Sort merchants">
            <SelectValue>{(v) => SORTS.find((s) => s.key === v)?.label ?? "Reliability"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((s) => (
              <SelectItem key={s.key} value={s.key}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <button
          type="button"
          onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
          aria-label={sortDir === "asc" ? "Ascending, switch to descending" : "Descending, switch to ascending"}
          className="inline-flex size-10 items-center justify-center rounded-lg border border-border text-muted-foreground"
        >
          {sortDir === "asc" ? <ArrowUp className="size-4" /> : <ArrowDown className="size-4" />}
        </button>
      </div>

      {sorted.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">No merchants match these filters.</p>
      ) : (
        <>
          <ul className="divide-y divide-border md:hidden">
            {visible.map((m, i) => (
              <MerchantCard key={m.id} m={m} rank={i + 1} flag={showcase[m.id]} />
            ))}
          </ul>

          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">Merchant</TableHead>
                  {SORTS.map((s) => (
                    <TableHead
                      key={s.key}
                      aria-sort={sortKey === s.key ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                      className={cn(
                        "text-right",
                        s.key === "lastSeenTs" && "hidden xl:table-cell",
                        (s.key === "askVsBest" || s.key === "bidVsBest" || s.key === "ownSpread") && "hidden lg:table-cell",
                        PROFILE_COLS.includes(s.key) && "hidden xl:table-cell",
                      )}
                    >
                      <span className="inline-flex items-center gap-1">
                        <SortH
                          label={s.label}
                          active={sortKey === s.key}
                          dir={sortDir}
                          onClick={() => toggle(s.key)}
                        />
                        {s.key === "trustScore" && <ReliabilityInfo className="m-0 size-6" />}
                        {s.key === "ownSpread" && (
                          <InfoPopover label="What own spread means" title="Own spread" className="m-0 size-6">
                            <p>
                              Best Sell-ad price − best Buy-ad price, per USDT, before fees. Shown only for merchants
                              listing both sides now.
                            </p>
                            <p>
                              <SpreadMedianText median={spreadMedian} />
                            </p>
                          </InfoPopover>
                        )}
                      </span>
                    </TableHead>
                  ))}
                  <TableHead className="w-10 pr-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((m, i) => (
                  <TableRow key={m.id} className={cn(!m.isActive && "text-muted-foreground")}>
                    <TableCell className="max-w-72 py-2.5 pl-4">
                      <NameBlock m={m} rank={i + 1} flag={showcase[m.id]} />
                    </TableCell>
                    <TableCell className="text-right">
                      <ScorePill value={m.trustScore} />
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{formatCount(m.orders30d)}</TableCell>
                    <TableCell className="text-right">
                      <Completion v={m.completionRate} />
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {sym} {formatCompact(m.totalAvailableFiat)}
                    </TableCell>
                    <TableCell className="hidden text-right lg:table-cell">
                      <Gap v={m.askVsBest} />
                    </TableCell>
                    <TableCell className="hidden text-right lg:table-cell">
                      <Gap v={m.bidVsBest} />
                    </TableCell>
                    <TableCell className="hidden text-right text-xs lg:table-cell">
                      <Spread m={m} stacked />
                    </TableCell>
                    <TableCell className="hidden text-right font-mono tabular-nums xl:table-cell">
                      <Release sec={m.avgReleaseSec} />
                    </TableCell>
                    <TableCell className="hidden text-right xl:table-cell">
                      <Feedback m={m} />
                    </TableCell>
                    <TableCell className="hidden text-right font-mono tabular-nums xl:table-cell">
                      <Age days={m.registerDays} />
                    </TableCell>
                    <TableCell className="hidden text-right text-xs xl:table-cell">
                      <LastSeen m={m} />
                    </TableCell>
                    <TableCell className="pr-4">
                      <div className="flex items-center justify-end gap-0.5">
                        <MerchantStar id={m.id} name={m.name} asset={ASSET} fiat={FIAT.code} className="size-8" />
                        <a
                          href={profile(m.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Open ${m.name} on ${adapter.label}`}
                          title={`Open on ${adapter.label}`}
                          className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <ExternalLink className="size-3.5" />
                        </a>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {sorted.length > limit && (
            <div className="border-t border-border p-3">
              <button
                type="button"
                onClick={() => setLimit((l) => l + PAGE)}
                className="h-10 w-full rounded-lg border border-border text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Show {Math.min(PAGE, sorted.length - limit)} more of {sorted.length - limit}
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function MerchantCard({
  m,
  rank,
  flag,
}: {
  m: MerchantRow;
  rank: number;
  flag: ShowcaseMap[string] | undefined;
}) {
  return (
    <li className={cn("space-y-2.5 px-4 py-3", !m.isActive && "text-muted-foreground")}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <NameBlock m={m} rank={rank} flag={flag} />
        </div>
        <ScorePill value={m.trustScore} />
        <MerchantStar id={m.id} name={m.name} asset={ASSET} fiat={FIAT.code} className="-my-2 -mr-2 size-10" />
      </div>
      <dl className="grid grid-cols-3 gap-2 text-xs">
        <Cell label="30d orders" value={formatCount(m.orders30d)} />
        <Cell label="Completion" value={<Completion v={m.completionRate} />} />
        <Cell label="Depth" value={`${sym} ${formatCompact(m.totalAvailableFiat)}`} />
        <Cell label="Ask vs best" value={<Gap v={m.askVsBest} />} />
        <Cell label="Bid vs best" value={<Gap v={m.bidVsBest} />} />
        <Cell label="Release" value={<Release sec={m.avgReleaseSec} />} />
        <Cell label="Feedback" value={<Feedback m={m} />} />
        <Cell label="Account age" value={<Age days={m.registerDays} />} />
        <Cell label="Seen" value={<LastSeen m={m} />} />
        <Cell className="col-span-3" label="Own spread (best Sell − best Buy)" value={<Spread m={m} />} />
      </dl>
    </li>
  );
}

function Cell({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="truncate font-mono tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function NameBlock({
  m,
  rank,
  flag,
}: {
  m: MerchantRow;
  rank: number;
  flag: ShowcaseMap[string] | undefined;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="w-6 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
        {rank}
      </span>
      <span className="relative shrink-0" aria-hidden>
        <span className="flex size-8 items-center justify-center rounded-full border border-border bg-muted font-mono text-[11px] text-muted-foreground">
          {(m.name || "?").slice(0, 2).toUpperCase()}
        </span>
        <span
          className={cn(
            "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-card",
            m.isActive ? "bg-[color:var(--color-buy)]" : "bg-muted-foreground/40",
          )}
        />
      </span>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <Link
            href={`/merchants/${encodeURIComponent(m.id)}`}
            className="-my-2.5 truncate py-2.5 text-sm font-medium text-foreground underline-offset-4 hover:underline"
          >
            {m.name}
          </Link>
          <TierBadge
            tier={deriveMerchantTier({ isMerchant: m.isMerchant, userIdentity: m.userIdentity, vipLevel: m.vipLevel })}
            size="xs"
          />
          {flag && <ShowcaseBadge flag={flag} />}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {m.isActive ? (
            <>
              {m.adCount} ad{m.adCount === 1 ? "" : "s"}
              {m.buyAds > 0 && <span className="text-[color:var(--color-sell)]"> · {m.buyAds} buy</span>}
              {m.sellAds > 0 && <span className="text-[color:var(--color-buy)]"> · {m.sellAds} sell</span>}
            </>
          ) : (
            "Offline"
          )}
        </div>
      </div>
    </div>
  );
}

/** Own spread while listing; "—" when offline. */
function Spread({ m, stacked = false }: { m: MerchantRow; stacked?: boolean }) {
  if (!m.isActive) return <span className="text-muted-foreground">—</span>;
  return <OwnSpreadText ask={m.bestSellPrice} bid={m.bestBuyPrice} stacked={stacked} />;
}

function LastSeen({ m }: { m: MerchantRow }) {
  return m.isActive ? (
    <span className="text-[color:var(--color-buy)]">now</span>
  ) : (
    <span className="font-mono tabular-nums" suppressHydrationWarning>
      {formatRelative(new Date(m.lastSeenTs * 1000))}
    </span>
  );
}

/** 30-day average release time (Binance profile). */
function Release({ sec }: { sec: number | null | undefined }) {
  if (sec == null || !(sec > 0)) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn(sec > 900 && "text-[color:var(--color-warn)]")}>
      {sec < 60 ? `${Math.round(sec)}s` : `${(sec / 60).toFixed(1)}m`}
    </span>
  );
}

/** Positive feedback share, with the review count in the title. */
function Feedback({ m }: { m: MerchantRow }) {
  if (m.positiveRate == null) return <span className="text-muted-foreground">—</span>;
  const few = (m.feedbackCount ?? 0) < 20;
  return (
    <span
      title={`${m.feedbackCount ?? 0} reviews`}
      className={cn(
        "font-mono tabular-nums",
        few ? "text-muted-foreground" : m.positiveRate >= 0.98 ? "text-foreground" : "text-[color:var(--color-warn)]",
      )}
    >
      {formatPct(m.positiveRate, { frac: 1 })}
    </span>
  );
}

/** Account age from the exchange's register date. */
function Age({ days }: { days: number | null | undefined }) {
  if (days == null) return <span className="text-muted-foreground">—</span>;
  return <span>{days >= 365 ? `${(days / 365).toFixed(1)}y` : `${days}d`}</span>;
}

function Completion({ v }: { v: number }) {
  return (
    <span
      className={cn(
        "font-mono tabular-nums",
        v >= 0.97 ? "text-foreground" : v >= 0.9 ? "text-[color:var(--color-warn)]" : "text-[color:var(--color-sell)]",
      )}
    >
      {formatPct(v, { frac: 1 })}
    </span>
  );
}

/** Gap to the side's best price among active merchants: 0 = best. */
function Gap({ v }: { v: number | null }) {
  if (v == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "font-mono tabular-nums",
        v < 0.00005 ? "text-foreground" : v > 0.01 ? "text-muted-foreground" : "text-foreground",
      )}
    >
      {v < 0.00005 ? "best" : `+${formatPct(v, { frac: 2 })}`}
    </span>
  );
}

function ScorePill({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <span
      title="Reliability score, 0–100"
      className={cn(
        "inline-flex h-6 min-w-9 shrink-0 items-center justify-center rounded-full px-2 font-mono text-xs font-semibold tabular-nums",
        v >= 80
          ? "bg-[color:var(--color-buy)]/12 text-[color:var(--color-buy)]"
          : v >= 60
            ? "bg-muted text-foreground"
            : "bg-[color:var(--color-sell)]/12 text-[color:var(--color-sell)]",
      )}
    >
      {v}
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
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1 text-xs font-medium transition-colors",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      <Icon className="size-3" />
    </button>
  );
}
