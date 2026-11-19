import Link from "next/link";
import { ArrowLeftRight, BellRing, ChevronRight, FileText, Filter, Landmark, Scale, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Empty } from "@/components/common/empty";
import { TierBadge } from "@/components/merchant/tier-badge";
import { ExchangeLink } from "@/components/dashboard/exchange-link";
import { getExchange } from "@/lib/exchanges";
import { FIAT } from "@/lib/constants";
import { formatFiat, formatInt, formatPct, formatRelative } from "@/lib/format";
import type { AlertEventRow, AlertType } from "@/lib/db/schema";
import type { FavouriteMerchant, SavedFilter } from "@/lib/dashboard";
import { cn } from "@/lib/utils";

const ITEM = "flex min-h-12 items-center gap-3 px-4 py-2.5 outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted";

/* ── Alerts ──────────────────────────────────────────────────────────── */

const ALERT_META: Record<AlertType, { label: string; unit: "price" | "percent" | "asset" }> = {
  priceAbove: { label: "Price above", unit: "price" },
  priceBelow: { label: "Price below", unit: "price" },
  spreadAbove: { label: "Spread above", unit: "percent" },
  spreadBelow: { label: "Spread below", unit: "percent" },
  depthBelow: { label: "Top-20 depth below", unit: "asset" },
  askDepthBelow: { label: "Sell-ad depth (1%) below", unit: "asset" },
  bidDepthBelow: { label: "Buy-ad depth (1%) below", unit: "asset" },
  offMarketAd: { label: "Off-market ad", unit: "percent" },
  usdGoogleUp: { label: "Google dollar up (2 h)", unit: "percent" },
  usdGoogleDown: { label: "Google dollar down (2 h)", unit: "percent" },
  usdCbslUp: { label: "CBSL dollar up (day)", unit: "percent" },
  usdCbslDown: { label: "CBSL dollar down (day)", unit: "percent" },
};

function fmtAlert(type: AlertType, v: number) {
  const unit = ALERT_META[type]?.unit ?? "price";
  if (unit === "percent") return formatPct(v, { frac: 2 });
  if (unit === "asset") return `${formatInt(v)} USDT`;
  return formatFiat(v, FIAT.symbol);
}

export function RecentAlerts({ events }: { events: AlertEventRow[] }) {
  if (!events.length) {
    return (
      <Empty
        icon={BellRing}
        title="No alerts yet"
        description="Set a price, spread or depth rule and we'll check it every minute and email you when it fires."
        className="py-8"
        action={
          <Link href="/alerts" className="inline-flex h-10 items-center rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted">
            Create an alert
          </Link>
        }
      />
    );
  }
  return (
    <Card className="gap-0 py-0">
      <ul className="divide-y divide-border">
        {events.map((e) => (
          <li key={e.id}>
            <Link href="/alerts" className={cn(ITEM, !e.read && "bg-muted/30")}>
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  e.read ? "bg-transparent" : "bg-[color:var(--color-warn)]",
                )}
                aria-label={e.read ? undefined : "Unread"}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{e.ruleLabel}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {getExchange(e.exchange).label} · {ALERT_META[e.type]?.label ?? e.type}{" "}
                  <span className="font-mono tabular-nums">{fmtAlert(e.type, e.threshold)}</span> · now{" "}
                  <span className="font-mono tabular-nums text-foreground">{fmtAlert(e.type, e.observed)}</span>
                </div>
              </div>
              <span className="shrink-0 text-[11px] text-muted-foreground">{formatRelative(new Date(e.ts * 1000))}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ── Favourite merchants ─────────────────────────────────────────────── */

export function FavouriteMerchants({ items }: { items: FavouriteMerchant[] }) {
  if (!items.length) {
    return (
      <Empty
        icon={Users}
        title="No favourite merchants"
        description="Star counterparties on the Merchants page to see if they're listing right now."
        className="py-8"
        action={
          <Link href="/merchants" className="inline-flex h-10 items-center rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted">
            Browse merchants
          </Link>
        }
      />
    );
  }
  return (
    <Card className="gap-0 py-0">
      <ul className="divide-y divide-border">
        {items.map((m) => (
          <li key={`${m.exchange}:${m.id}`}>
            <ExchangeLink exchange={m.exchange} href={`/merchants/${encodeURIComponent(m.id)}`} className={ITEM}>
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  m.live ? "bg-[color:var(--color-buy)]" : "bg-muted-foreground/40",
                )}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{m.name}</span>
                  <TierBadge tier={m.tier} />
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {getExchange(m.exchange).label} · {m.live ? "Live" : m.live === false ? "Offline" : "Not seen yet"}
                  {m.completionRate != null && ` · ${formatPct(m.completionRate, { frac: 1 })}`}
                  {m.orders30d != null && ` · ${formatInt(m.orders30d)} orders`}
                </div>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </ExchangeLink>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ── Saved filters ───────────────────────────────────────────────────── */

export function SavedFilters({ items }: { items: SavedFilter[] }) {
  if (!items.length) {
    return (
      <p className="flex items-start gap-2 rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
        <Filter className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>No saved filters. Use “Save filter” on a market or merchant view to jump back to it from here.</span>
      </p>
    );
  }
  return (
    <Card className="gap-0 py-0">
      <ul className="divide-y divide-border">
        {items.map((f) => (
          <li key={f.key}>
            <Link href={f.href} className={ITEM}>
              <Filter className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{f.label}</div>
                <div className="truncate font-mono text-[11px] text-muted-foreground">{f.href}</div>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ── Quick links ─────────────────────────────────────────────────────── */

const QUICK = [
  { href: "/compare", label: "Compare", sub: "Binance vs Bybit", icon: Scale },
  { href: "/arbitrage", label: "Arbitrage", sub: "Cross-exchange gaps", icon: ArrowLeftRight },
  { href: "/rates", label: "Rates", sub: "CBSL & bank rates", icon: Landmark },
  { href: "/reports", label: "Reports", sub: "Exports & summaries", icon: FileText },
] as const;

export function QuickLinks() {
  return (
    <div className="grid grid-cols-2 gap-3">
      {QUICK.map(({ href, label, sub, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className="flex min-h-16 items-center gap-3 rounded-xl bg-card px-3 py-3 ring-1 ring-foreground/10 transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{label}</div>
            <div className="truncate text-[11px] text-muted-foreground">{sub}</div>
          </div>
        </Link>
      ))}
    </div>
  );
}
