import type { ShowcaseFlag } from "@/lib/market-insights";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Plain-language explanation shared by badges and callouts. */
export function showcaseReason(f: ShowcaseFlag) {
  const unit = f.amountUnit === "asset" ? "USDT" : "LKR";
  const expected = Math.max(1, Math.round(f.expectedOrders));
  return `Listed amount (${unit}) and 30-day order count haven't changed in ${formatDuration(
    f.spanSec,
  )} (${f.samples} sweeps), although this merchant's usual pace predicts about ${expected} orders in that time. This ad may not really be trading. Estimate only.`;
}

/**
 * Small warn-tinted tag for advertisers flagged by the showcase heuristic.
 * The title carries the explanation for hover; the text itself says it's a
 * guess so it's never read as a verdict.
 */
export function ShowcaseBadge({ flag, className }: { flag: ShowcaseFlag; className?: string }) {
  return (
    <span
      title={showcaseReason(flag)}
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-sm border border-[color:var(--color-warn)]/40 px-1.5 text-[10px] font-medium text-[color:var(--color-warn)]",
        className,
      )}
    >
      Static ad?
    </span>
  );
}
