import { cn } from "@/lib/utils";
import type { MerchantTier } from "@/lib/merchant-tier";
import { TIER_LABEL } from "@/lib/merchant-tier";

/**
 * Tiny verified-merchant tier badge — matches Bybit's bronze/silver/gold
 * visual convention so users recognise it at a glance. Renders as a small
 * rounded shield with a tier-tinted gradient + a subtle check mark.
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
      className={cn(
        "inline-flex items-center gap-1 align-middle",
        className,
      )}
      title={`${TIER_LABEL[tier]} Verified Merchant · from Bybit`}
    >
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-[4px] ring-1",
          dims,
          TIER_STYLES[tier].wrap,
        )}
        style={TIER_STYLES[tier].style}
      >
        <CheckIcon className={cn("h-[60%] w-[60%]", TIER_STYLES[tier].check)} />
      </span>
      {withLabel && (
        <span
          className={cn(
            "font-semibold uppercase tracking-wider",
            labelSize,
            TIER_STYLES[tier].label,
          )}
        >
          {TIER_LABEL[tier]}
        </span>
      )}
    </span>
  );
}

/**
 * Tier colour tokens. Gradients roughly match Bybit's own
 * `verified-merchant-{tier}.png` spritesheet so users recognise the badges
 * at a glance without us pulling their CDN assets.
 */
const TIER_STYLES: Record<
  MerchantTier,
  {
    wrap: string;
    label: string;
    check: string;
    style: React.CSSProperties;
  }
> = {
  bronze: {
    wrap: "ring-[#a8632a]/40",
    label: "text-[#c58042]",
    check: "text-[#3a1d07]",
    style: {
      backgroundImage:
        "linear-gradient(145deg, #f5c08a 0%, #d08a4e 45%, #9b5a24 100%)",
    },
  },
  silver: {
    wrap: "ring-[#a8adb5]/50",
    label: "text-[#c9ced6]",
    check: "text-[#2a2d33]",
    style: {
      backgroundImage:
        "linear-gradient(145deg, #eef2f7 0%, #c1c7d0 45%, #8a9099 100%)",
    },
  },
  gold: {
    wrap: "ring-[#d4a23b]/50",
    label: "text-[#f2c35b]",
    check: "text-[#3a2505]",
    style: {
      backgroundImage:
        "linear-gradient(145deg, #ffe299 0%, #e6ba3d 45%, #b5871f 100%)",
    },
  },
};

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M3.5 8.5 L6.5 11.5 L12.5 5"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
