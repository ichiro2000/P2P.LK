import { cn } from "@/lib/utils";
import { ACTIVE_EXCHANGE, OTHER_EXCHANGE_URL } from "@/lib/exchange";

/**
 * Two-tab segmented control that lets users hop between the Binance and the
 * Bybit deployments of P2P.LK. The active exchange is fixed per-build via
 * `ACTIVE_EXCHANGE` and the inactive tab links to the sister deployment
 * (URL set via `NEXT_PUBLIC_OTHER_EXCHANGE_URL` so the same component drops
 * into both branches unchanged).
 *
 * Renders nothing if the other-site URL isn't configured — better to hide
 * the tab than ship a dead link.
 */
export function ExchangeSwitch({ className }: { className?: string }) {
  const otherUrl = OTHER_EXCHANGE_URL?.trim();
  if (!otherUrl) return null;

  const isBybit = ACTIVE_EXCHANGE === "bybit";
  return (
    <div
      className={cn(
        // Visible at every viewport — even narrow phones — because the
        // switcher is the primary way users hop between deployments and
        // hiding it on mobile defeats the purpose. Compact 10px text keeps
        // it from crowding the rest of the topbar on small screens.
        "inline-flex items-center rounded-md border border-border bg-card/50 p-0.5 text-[10px] sm:text-[11px] font-medium",
        className,
      )}
      role="tablist"
      aria-label="Exchange"
    >
      <Tab label="Binance" active={!isBybit} href={isBybit ? otherUrl : null} />
      <Tab label="Bybit" active={isBybit} href={isBybit ? null : otherUrl} />
    </div>
  );
}

function Tab({
  label,
  active,
  href,
}: {
  label: string;
  active: boolean;
  /** null when this tab represents the current site (no link). */
  href: string | null;
}) {
  const className = cn(
    "inline-flex h-6 items-center rounded-[5px] px-2.5 leading-none transition-colors",
    active
      ? "bg-primary/15 text-primary ring-1 ring-primary/30"
      : "text-muted-foreground hover:text-foreground",
  );

  if (active || !href) {
    return (
      <span
        className={className}
        role="tab"
        aria-selected={active}
        aria-current={active ? "page" : undefined}
      >
        {label}
      </span>
    );
  }
  return (
    <a
      className={className}
      href={href}
      role="tab"
      aria-selected={false}
      // Cross-domain hop — let the browser do a full nav so each site owns
      // its own runtime/state. No prefetch.
      rel="noopener"
    >
      {label}
    </a>
  );
}
