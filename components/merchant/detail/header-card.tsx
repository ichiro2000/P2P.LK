import { ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { MerchantStar } from "@/components/workspace/star-button";
import { BlockMerchantButton } from "@/components/members/block-merchant-button";
import type { ExchangeId } from "@/lib/exchanges/types";
import { TierBadge } from "@/components/merchant/tier-badge";
import { ShowcaseBadge, showcaseReason } from "@/components/merchant/showcase-badge";
import { deriveMerchantTier } from "@/lib/merchant-tier";
import type { ShowcaseFlag } from "@/lib/market-insights";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

export type MerchantHeaderData = {
  id: string;
  /** Public profile on the exchange this merchant was seen on. */
  profileUrl: string;
  exchangeLabel: string;
  /** Exchange id, for favourites and the blocklist. */
  exchange: ExchangeId;
  name: string;
  isMerchant: boolean;
  userIdentity: string | null;
  vipLevel: number | null;
  isActive: boolean;
  lastSeenTs: number;
  asset: string;
  fiat: string;
  showcase: ShowcaseFlag | null;
};

/** Identity block: name, tier, live status, favourite, block and exchange link. */
export function MerchantHeaderCard({ m }: { m: MerchantHeaderData }) {
  return (
    <Card className="gap-3 px-4 py-4">
      <div className="flex items-start gap-3">
        <span className="relative shrink-0" aria-hidden>
          <span className="flex size-12 items-center justify-center rounded-full border border-border bg-muted font-mono text-sm text-muted-foreground">
            {(m.name || "?").slice(0, 2).toUpperCase()}
          </span>
          <span
            className={cn(
              "absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-card",
              m.isActive ? "bg-[color:var(--color-buy)]" : "bg-muted-foreground/40",
            )}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="min-w-0 truncate text-lg font-semibold tracking-tight">{m.name}</h2>
            <TierBadge
              tier={deriveMerchantTier({ isMerchant: m.isMerchant, userIdentity: m.userIdentity, vipLevel: m.vipLevel })}
              size="md"
              withLabel
            />
            {m.showcase && <ShowcaseBadge flag={m.showcase} />}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span className={cn(m.isActive && "text-[color:var(--color-buy)]")}>
              {m.isActive ? "On the book now" : `Last seen ${formatRelative(new Date(m.lastSeenTs * 1000))}`}
            </span>
            {" · "}
            {m.asset}/{m.fiat} on {m.exchangeLabel}
          </p>
          <p className="truncate font-mono text-[11px] text-muted-foreground" title={m.id}>
            {m.id}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <MerchantStar
            id={m.id}
            name={m.name}
            asset={m.asset}
            fiat={m.fiat}
            exchange={m.exchange}
            className="size-10 md:size-8"
          />
          <BlockMerchantButton exchange={m.exchange} id={m.id} name={m.name} asset={m.asset} fiat={m.fiat} />
          <a
            href={m.profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View ${m.name} on ${m.exchangeLabel}`}
            className="inline-flex size-10 items-center justify-center gap-1.5 rounded-lg border border-border text-sm text-muted-foreground transition-colors hover:text-foreground md:h-8 md:w-auto md:px-3"
          >
            <ExternalLink className="size-4" />
            <span className="hidden md:inline">{m.exchangeLabel}</span>
          </a>
        </div>
      </div>
      {m.showcase && (
        <p className="rounded-lg border border-[color:var(--color-warn)]/40 bg-[color:var(--color-warn)]/10 px-3 py-2 text-xs text-foreground">
          {showcaseReason(m.showcase)}
        </p>
      )}
    </Card>
  );
}
