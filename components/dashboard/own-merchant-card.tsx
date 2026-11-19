import Link from "next/link";
import { ArrowRight, Link2, SearchX, Store, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TierBadge } from "@/components/merchant/tier-badge";
import { ExchangeLink } from "@/components/dashboard/exchange-link";
import { getExchange } from "@/lib/exchanges";
import { FIAT } from "@/lib/constants";
import { formatFiat, formatInt, formatPct, formatRelative, formatSigned } from "@/lib/format";
import type { BookRank, OwnMerchant } from "@/lib/dashboard";
import { cn } from "@/lib/utils";
import { ownSpread } from "@/lib/competitors";
import { NetOwnSpread, SpreadMedianText } from "@/components/merchant/own-spread";

const ROW = "flex min-h-10 items-center justify-between gap-3";

/** "Your merchant": the member's own advertiser, matched from their profile links. */
export function OwnMerchantCard({ own, hasAnyLink }: { own: OwnMerchant[]; hasAnyLink: boolean }) {
  if (!own.length) {
    return (
      <Card className="gap-3 px-4 py-4">
        <div className="flex items-start gap-3">
          <IconBubble>
            <Link2 className="size-4" aria-hidden />
          </IconBubble>
          <div className="min-w-0 space-y-1">
            <div className="text-sm font-medium">
              {hasAnyLink ? "We can't read an advertiser id from your link" : "Link your merchant profile"}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {hasAnyLink
                ? "Use the full profile link. On Binance it contains advertiserNo=…; on Bybit it looks like bybit.com/en/p2p/profile/…"
                : "Add your Binance or Bybit advertiser link to see your rank on the book, completion, orders and price against the best ad."}
            </p>
          </div>
        </div>
        <Link
          href="/account#profile"
          className="inline-flex h-10 w-fit items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted"
        >
          {hasAnyLink ? "Fix the link" : "Add a link"} <ArrowRight className="size-4" aria-hidden />
        </Link>
      </Card>
    );
  }
  return (
    <div className="grid gap-3">
      {own.map((m) => (m.status === "found" ? <Found key={m.exchange} m={m} /> : <Missing key={m.exchange} m={m} />))}
    </div>
  );
}

function Missing({ m }: { m: Extract<OwnMerchant, { status: "missing" }> }) {
  const label = getExchange(m.exchange).label;
  return (
    <Card className="gap-3 px-4 py-4">
      <div className="flex items-start gap-3">
        <IconBubble>
          <SearchX className="size-4" aria-hidden />
        </IconBubble>
        <div className="min-w-0 space-y-1">
          <div className="text-sm font-medium">Not on the {label} LKR book yet</div>
          <p className="text-xs leading-relaxed break-words text-muted-foreground">
            We haven&apos;t seen advertiser <span className="font-mono">{m.id}</span> on {label} USDT/LKR bank-transfer
            ads. It shows up here a few minutes after your first ad goes live. If the id is wrong, update your link.
          </p>
        </div>
      </div>
      <Link
        href="/account#profile"
        className="inline-flex h-10 w-fit items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted"
      >
        Check your link <ArrowRight className="size-4" aria-hidden />
      </Link>
    </Card>
  );
}

function Found({ m }: { m: Extract<OwnMerchant, { status: "found" }> }) {
  const label = getExchange(m.exchange).label;
  const sym = FIAT.symbol;
  // Prices only mean something while they're listing.
  const ask = m.live ? m.lastAsk : null;
  const bid = m.live ? m.lastBid : null;
  const spread = ownSpread(ask, bid);
  const page = `/merchants/${encodeURIComponent(m.id)}`;
  return (
    <Card className="gap-4 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <IconBubble>
            <Store className="size-4" aria-hidden />
          </IconBubble>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-sm font-semibold">{m.name}</span>
              <TierBadge tier={m.tier} size="sm" />
            </div>
            <div className="text-xs text-muted-foreground">
              {label} · {m.live ? "listing now" : `last seen ${formatRelative(new Date(m.lastSeenTs * 1000))}`}
            </div>
          </div>
        </div>
        <Badge variant="outline" className="shrink-0 gap-1.5">
          <span
            className={cn(
              "size-1.5 rounded-full",
              m.live ? "bg-[color:var(--color-buy)]" : "bg-muted-foreground/50",
            )}
            aria-hidden
          />
          {m.live ? "Live" : "Offline"}
        </Badge>
      </div>

      <dl className="grid grid-cols-3 gap-x-3 gap-y-3">
        <Stat label="Reliability" value={`${m.trustScore}/100`} />
        <Stat label="Completion" value={formatPct(m.completionRate, { frac: 1 })} />
        <Stat label="30d orders" value={formatInt(m.orders30d)} />
      </dl>

      <div className="divide-y divide-border rounded-lg border border-border">
        <RankRow
          title="Selling USDT"
          hint="vs the lowest ask"
          rank={m.ask}
          below={m.live && m.scanned?.listsAsk && m.scanned.ask >= m.scanned.cap ? m.scanned.cap : null}
          last={m.lastAsk}
          market={m.marketAsk}
          sym={sym}
        />
        <RankRow
          title="Buying USDT"
          hint="vs the highest bid"
          rank={m.bid}
          below={m.live && m.scanned?.listsBid && m.scanned.bid >= m.scanned.cap ? m.scanned.cap : null}
          last={m.lastBid}
          market={m.marketBid}
          sym={sym}
        />
      </div>

      <div className="space-y-1 rounded-lg border border-border px-3 py-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-xs font-medium">Own spread</div>
          <div className="text-right font-mono text-sm font-semibold tabular-nums">
            {spread ? (
              <>
                {formatFiat(spread.lkr, sym)}{" "}
                <span className="text-xs font-normal text-muted-foreground">{formatPct(spread.pct, { frac: 2 })}</span>
              </>
            ) : (
              <span className="font-sans text-xs font-normal text-muted-foreground">
                {m.live ? "one side only" : "not listing now"}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-1 text-[11px] text-muted-foreground">
          <span>Best Sell ad − best Buy ad, per USDT</span>
          <SpreadMedianText median={m.spreadMedian} ask={spread ? ask : undefined} bid={bid} scope="advertisers" />
          {spread && <NetOwnSpread ask={ask} bid={bid} />}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <ExchangeLink
          exchange={m.exchange}
          href={page}
          className="inline-flex h-10 w-fit items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted"
        >
          Full merchant page <ArrowRight className="size-4" aria-hidden />
        </ExchangeLink>
        <ExchangeLink
          exchange={m.exchange}
          href={`${page}#compare`}
          className="inline-flex h-10 w-fit items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted"
        >
          <Users className="size-4" aria-hidden /> Compare competitors
        </ExchangeLink>
      </div>
    </Card>
  );
}

function RankRow({
  title,
  hint,
  rank,
  below,
  last,
  market,
  sym,
}: {
  title: string;
  hint: string;
  rank: BookRank;
  /** Book was cut at this many ads and they weren't in it. */
  below?: number | null;
  last: number | null;
  market: number | null;
  sym: string;
}) {
  return (
    <div className={cn(ROW, "px-3 py-2")}>
      <div className="min-w-0">
        <div className="text-xs font-medium">{title}</div>
        <div className="truncate text-[11px] text-muted-foreground">{hint}</div>
      </div>
      {rank ? (
        <div className="shrink-0 text-right">
          <div className="font-mono text-sm font-semibold tabular-nums">
            #{rank.position}
            <span className="font-sans text-xs font-normal text-muted-foreground">
              {" "}
              of {rank.of}
              {rank.capped ? "+" : ""}
            </span>
          </div>
          <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {formatFiat(rank.price, sym)}{" "}
            {rank.diff != null && rank.diff > 0.0001 ? (
              <span className="text-[color:var(--color-warn)]">{formatSigned(rank.diff)} vs best</span>
            ) : (
              <span className="text-[color:var(--color-buy)]">best price</span>
            )}
          </div>
        </div>
      ) : (
        <div className="shrink-0 text-right text-[11px] text-muted-foreground">
          <div>{below ? `Below the top ${below}` : "Not on the book"}</div>
          {last != null && (
            <div className="font-mono tabular-nums">
              last {formatFiat(last, sym)}
              {market != null ? ` · best ${formatFiat(market, sym)}` : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="truncate font-mono text-base font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function IconBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-border">
      {children}
    </div>
  );
}
