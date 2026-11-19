import { useId } from "react";
import { cn } from "@/lib/utils";
import type { MerchantTier } from "@/lib/merchant-tier";
import { TIER_LABEL } from "@/lib/merchant-tier";

/**
 * Verified-merchant tier badge: a bronze / silver / gold scalloped seal with
 * a white chevron tick (our own drawing), so traders recognise the level at
 * a glance.
 *
 * `size="xs"` (default) is intended to sit inline with merchant names;
 * `"sm"` is sized for lists; `"md"` is sized for detail headers.
 */
export function TierBadge({
  tier,
  size = "xs",
  withLabel = false,
  className,
}: {
  tier: MerchantTier | null;
  size?: "xs" | "sm" | "md";
  withLabel?: boolean;
  className?: string;
}) {
  if (!tier) return null;

  const dims =
    size === "md" ? "h-5 w-5" : size === "sm" ? "h-4 w-4" : "h-3.5 w-3.5";
  const labelSize =
    size === "md" ? "text-[11px]" : size === "sm" ? "text-[10px]" : "text-[9px]";

  return (
    <span
      className={cn("inline-flex items-center gap-1 align-middle", className)}
      title={`${TIER_LABEL[tier]} verified advertiser (Binance merchant level or Bybit VA / VA2 / VA3 badge)`}
    >
      <TierSeal tier={tier} className={dims} />
      {withLabel && (
        <span className={cn("font-semibold uppercase tracking-wider", labelSize, TIER_STYLES[tier].label)}>
          {TIER_LABEL[tier]}
        </span>
      )}
    </span>
  );
}

/** 8-lobe scalloped seal (24-unit grid). Tips are rounded by a same-paint
 *  stroke with round joins, so it reads as a soft rosette, not a star. */
const SEAL =
  "M12 1L15.56 3.41L19.78 4.22L20.59 8.44L23 12L20.59 15.56L19.78 19.78L15.56 20.59L12 23L8.44 20.59L4.22 19.78L3.41 15.56L1 12L3.41 8.44L4.22 4.22L8.44 3.41Z";

/**
 * Metallic seal with a white chevron tick: bronze / silver / gold from the
 * theme tokens (--tier-{tier}-1..3, light → dark), a soft top highlight and a
 * hairline edge. Identical in light and dark mode, like a physical badge.
 */
function TierSeal({ tier, className }: { tier: MerchantTier; className?: string }) {
  // Unique per instance: a shared id breaks when its first copy sits inside a
  // display:none container (e.g. the phone-card layout on desktop).
  const id = `p2plk-seal-${tier}-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg viewBox="0 0 24 24" className={cn("shrink-0", className)} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0%" style={{ stopColor: `var(--tier-${tier}-1)` }} />
          <stop offset="55%" style={{ stopColor: `var(--tier-${tier}-2)` }} />
          <stop offset="100%" style={{ stopColor: `var(--tier-${tier}-3)` }} />
        </linearGradient>
      </defs>
      <path d={SEAL} fill={`url(#${id})`} stroke={`url(#${id})`} strokeWidth="1.6" strokeLinejoin="round" />
      <path d={SEAL} fill="none" stroke="black" strokeOpacity="0.14" strokeWidth="0.6" strokeLinejoin="round" />
      <ellipse cx="12" cy="8" rx="6.5" ry="3.6" fill="white" opacity="0.22" />
      <path
        d="M7.6 10.4 12 14.6l4.4-4.2"
        fill="none"
        stroke="white"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Label colours (theme tokens; class names written out for Tailwind). */
const TIER_STYLES: Record<MerchantTier, { label: string }> = {
  bronze: { label: "text-[color:var(--tier-bronze)]" },
  silver: { label: "text-[color:var(--tier-silver)]" },
  gold: { label: "text-[color:var(--tier-gold)]" },
};
