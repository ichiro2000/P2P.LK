import { ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Stat } from "@/components/common/stat";
import { MerchantStar } from "@/components/workspace/star-button";
import { TierBadge } from "@/components/merchant/tier-badge";
import { deriveMerchantTier } from "@/lib/merchant-tier";
import {
  formatCompact,
  formatDuration,
  formatFiat,
  formatPct,
  formatRelative,
} from "@/lib/format";
import { cn } from "@/lib/utils";

export type MerchantHeaderData = {
  id: string;
  name: string;
  isMerchant: boolean;
  userIdentity: string | null;
  vipLevel: number | null;
  isActive: boolean;
  ordersMonth: number | null;
  completionRate: number | null;
  avgReleaseSec: number | null;
  bestBuyPrice: number | null;
  bestSellPrice: number | null;
  totalAvailableFiat: number | null;
  buyAds: number | null;
  sellAds: number | null;
  lastSeenTs: number;
  marketMid: number | null;
  asset: string;
  fiat: string;
  symbol: string;
  trustScore: number;
};

function bybitUrl(id: string, asset: string, fiat: string) {
  return `https://www.bybit.com/en/p2p/profile/${encodeURIComponent(
    id,
  )}/${encodeURIComponent(asset)}/${encodeURIComponent(fiat)}/item`;
}

export function MerchantHeaderCard({ m }: { m: MerchantHeaderData }) {
  const merchantMid =
    m.bestBuyPrice != null && m.bestSellPrice != null
      ? (m.bestBuyPrice + m.bestSellPrice) / 2
      : m.bestBuyPrice ?? m.bestSellPrice ?? null;
  const premium =
    merchantMid != null && m.marketMid != null && m.marketMid > 0
      ? (merchantMid - m.marketMid) / m.marketMid
      : null;
  const ownSpread =
    m.bestBuyPrice != null && m.bestSellPrice != null
      ? m.bestSellPrice - m.bestBuyPrice
      : null;

  return (
    <Card className="border-border bg-card/60">
      <CardContent className="flex flex-col gap-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="relative shrink-0">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted/50 font-mono text-sm font-medium text-muted-foreground">
                {(m.name || "?").slice(0, 2).toUpperCase()}
              </div>
              <span
                aria-hidden
                className={cn(
                  "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card",
                  m.isActive
                    ? "bg-[color:var(--color-buy)]"
                    : "bg-muted-foreground/40",
                )}
              />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-lg font-semibold text-foreground">
                  {m.name}
                </h1>
                <TierBadge
                  tier={deriveMerchantTier({
                    isMerchant: m.isMerchant,
                    userIdentity: m.userIdentity,
                    vipLevel: m.vipLevel,
                  })}
                  size="md"
                  withLabel
                />
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider",
                    m.isActive
                      ? "bg-[color:var(--color-buy-muted)] text-[color:var(--color-buy)]"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {m.isActive ? "Active" : "Offline"}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                <span className="font-mono">{m.asset}/{m.fiat}</span>
                <span className="text-muted-foreground/40">·</span>
                <span
                  className="truncate font-mono text-muted-foreground/70"
                  title={m.id}
                >
                  {m.id}
                </span>
                <span className="text-muted-foreground/40">·</span>
                <span>
                  {m.isActive
                    ? "Live on book"
                    : `Last seen ${formatRelative(new Date(m.lastSeenTs * 1000))}`}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <MerchantStar
              id={m.id}
              name={m.name}
              asset={m.asset}
              fiat={m.fiat}
            />
            <a
              href={bybitUrl(m.id, m.asset, m.fiat)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card/50 px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary"
            >
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
              View on Bybit
            </a>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-4 lg:grid-cols-6">
          <Stat
            label="Best buy"
            value={
              m.bestBuyPrice != null
                ? formatFiat(m.bestBuyPrice, m.symbol, 4)
                : "—"
            }
            footnote={
              (m.buyAds ?? 0) > 0
                ? `${m.buyAds} BUY ad${m.buyAds === 1 ? "" : "s"}`
                : "No live BUY ads"
            }
          />
          <Stat
            label="Best sell"
            value={
              m.bestSellPrice != null
                ? formatFiat(m.bestSellPrice, m.symbol, 4)
                : "—"
            }
            footnote={
              (m.sellAds ?? 0) > 0
                ? `${m.sellAds} SELL ad${m.sellAds === 1 ? "" : "s"}`
                : "No live SELL ads"
            }
          />
          <Stat
            label="Premium vs mkt"
            value={premium == null ? "—" : formatPct(premium, { frac: 2, sign: true })}
            footnote="merchant mid − market mid"
          />
          <Stat
            label="Own spread"
            value={ownSpread == null ? "—" : formatFiat(ownSpread, m.symbol, 4)}
            footnote="sell − buy on their book"
          />
          <Stat
            label="30d orders"
            value={
              m.ordersMonth != null ? formatCompact(m.ordersMonth) : "—"
            }
            footnote={
              m.completionRate != null
                ? `${formatPct(m.completionRate, { frac: 1 })} complete`
                : undefined
            }
          />
          <Stat
            label="Trust score"
            value={Math.round(m.trustScore).toString()}
            footnote={
              m.avgReleaseSec != null
                ? `release ~${formatDuration(m.avgReleaseSec)}`
                : "0–100 composite"
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}
