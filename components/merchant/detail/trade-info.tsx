import { BadgeCheck, CircleDashed, Info, Mail, Phone, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatInt, formatPct, formatRelative, formatSLT } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TRADE_SIDES as SIDE } from "@/lib/trade-trend";
import type { MerchantProfileRow } from "@/lib/db/schema";

/**
 * "Trade info" — the same numbers Binance shows in the advertiser page's
 * Trade Info panel, from lib/ingest/profiles.ts. Bybit's profile needs a
 * login, so Bybit merchants get an explanatory note and what their ads carry.
 */

const minutes = (sec: number | null | undefined) =>
  sec == null || !(sec > 0) ? "—" : `${(sec / 60).toFixed(2)} min`;
const days = (n: number | null | undefined) => (n == null ? "—" : `${formatInt(n)} day${n === 1 ? "" : "s"} ago`);

/** Binance `chanelInvolved`: c2c_only = trades only on P2P; c2c_beyond = also uses other Binance products. */
const TRADE_TYPES: Record<string, string> = { c2c_only: "P2P only", c2c_beyond: "P2P and beyond" };

function Stat({ label, value, sub, className }: { label: string; value: React.ReactNode; sub?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 space-y-0.5", className)}>
      <dt className="truncate text-[11px] text-muted-foreground">{label}</dt>
      <dd className="truncate font-mono text-sm font-semibold tabular-nums sm:text-base">{value}</dd>
      {sub && <dd className="truncate text-[11px] text-muted-foreground">{sub}</dd>}
    </div>
  );
}

function Flag({ ok, icon: Icon, label }: { ok: boolean | null; icon: typeof Mail; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px]",
        ok ? "border-[color:var(--color-buy)]/30 text-[color:var(--color-buy)]" : "border-border text-muted-foreground",
      )}
    >
      <Icon className="size-3" aria-hidden />
      {label}
      <span className="sr-only">{ok == null ? "unknown" : ok ? "verified" : "not verified"}</span>
      {ok === false && <span aria-hidden> ✕</span>}
    </span>
  );
}

/** Split bar for all-time buy vs sell (merchant's side). */
function SplitBar({ buy, sell }: { buy: number; sell: number }) {
  const total = buy + sell;
  const soldPct = total ? (sell / total) * 100 : 50;
  return (
    <div className="space-y-1.5">
      <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full bg-[color:var(--color-buy)]" style={{ width: `${soldPct}%` }} />
        <div className="h-full flex-1 bg-[color:var(--color-sell)]" />
      </div>
      <div className="flex flex-wrap justify-between gap-x-3 text-[11px]">
        <span className="text-[color:var(--color-buy)]">
          {SIDE.sold.label}: <span className="font-mono tabular-nums">{formatInt(sell)}</span>
        </span>
        <span className="text-[color:var(--color-sell)]">
          {SIDE.bought.label}: <span className="font-mono tabular-nums">{formatInt(buy)}</span>
        </span>
      </div>
    </div>
  );
}

function Shell({ children, description }: { children: React.ReactNode; description: React.ReactNode }) {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm font-medium">Trade info</CardTitle>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent className="px-4">{children}</CardContent>
    </Card>
  );
}

export function TradeInfoCard({ profile }: { profile: MerchantProfileRow }) {
  const p = profile;
  const reviews = p.positive != null && p.negative != null ? p.positive + p.negative : null;
  const lastActive = p.lastActiveMs != null ? new Date(p.lastActiveMs) : null;
  const asOf = p.okAt ?? p.fetchedAt;
  return (
    <Shell
      description={
        <>
          From the Binance profile, as of {formatSLT(asOf)} SLT · counts cover every fiat market they trade, not LKR
          only.
          {!p.ok && p.error && (
            <span className="text-[color:var(--color-warn)]"> Last refresh failed ({p.error}); showing the previous values.</span>
          )}
        </>
      }
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="30-day trades" value={formatInt(p.orders30d)} sub={p.buy30d != null && p.sell30d != null ? `${formatInt(p.sell30d)} sold · ${formatInt(p.buy30d)} bought` : undefined} />
        <Stat label="30-day completion" value={formatPct(p.completion30d, { frac: 2 })} />
        <Stat label="Avg. release time" value={minutes((p.orders30d ?? 0) > 0 ? p.avgReleaseSec : null)} sub="30 days" />
        <Stat label="Avg. pay time" value={minutes((p.orders30d ?? 0) > 0 ? p.avgPaySec : null)} sub="30 days" />
        <Stat
          label="Positive feedback"
          value={formatPct(p.positiveRate, { frac: 2 })}
          sub={reviews != null ? `${formatInt(p.positive)} positive · ${formatInt(p.negative)} negative` : "No reviews"}
        />
        <Stat label="Trade type" value={p.tradeType ? (TRADE_TYPES[p.tradeType] ?? p.tradeType) : "—"} />
        <Stat label="Registered" value={days(p.registerDays)} />
        <Stat label="First trade" value={days(p.firstTradeDays)} />
        <Stat label="Counterparties" value={formatInt(p.counterparties)} />
        <Stat label="Deposit" value={p.depositUsdt != null ? `${formatInt(p.depositUsdt)} USDT` : "—"} sub="held by Binance" />
        <Stat
          label="Last active"
          value={lastActive ? formatRelative(lastActive) : "—"}
          sub={lastActive ? `${formatSLT(lastActive)} SLT` : undefined}
          className="col-span-2 sm:col-span-1"
        />
      </dl>

      {p.completedBuy != null && p.completedSell != null && (
        <div className="mt-4 space-y-2 border-t border-border pt-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs text-muted-foreground">All trades</span>
            <span className="font-mono text-sm font-semibold tabular-nums">{formatInt(p.completedOrders)}</span>
          </div>
          <SplitBar buy={p.completedBuy} sell={p.completedSell} />
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Flag ok={p.kycVerified} icon={ShieldCheck} label="KYC" />
        <Flag ok={p.emailVerified} icon={Mail} label="Email" />
        <Flag ok={p.mobileVerified} icon={Phone} label="Phone" />
        {p.userIdentity && <Flag ok icon={BadgeCheck} label={p.userIdentity.replace(/_/g, " ").toLowerCase()} />}
      </div>
    </Shell>
  );
}

/** Not collected yet (on-demand fetch timed out or failed). */
export function TradeInfoCollecting({ error }: { error?: string | null }) {
  return (
    <Shell description="From the Binance profile.">
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <CircleDashed className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          Collecting this merchant&apos;s trade info. Our collector refreshes every Binance merchant on the book every
          few hours; check back shortly.
          {error && <span className="block text-xs">Last attempt: {error}</span>}
        </span>
      </p>
    </Shell>
  );
}

/** Bybit: the profile endpoint needs a login, so only ad data exists. */
export function TradeInfoBybit({ orders30d, completionRate }: { orders30d: number | null; completionRate: number | null }) {
  return (
    <Shell description="From Bybit's public ads.">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Stat label="30-day trades" value={formatInt(orders30d)} />
        <Stat label="30-day completion" value={formatPct(completionRate, { frac: 2 })} />
      </dl>
      <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          Bybit only shows a merchant&apos;s full profile (all-time trades, buy/sell split, feedback, release time, account
          age) to signed-in users, so we can&apos;t collect it. These two numbers come from their ads;
          buy/sell trade trends are available for Binance merchants only.
        </span>
      </p>
    </Shell>
  );
}

export function TradeInfoSkeleton() {
  return (
    <Shell description="Loading the Binance profile…">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4" aria-busy>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-5 w-16" />
          </div>
        ))}
      </div>
    </Shell>
  );
}
