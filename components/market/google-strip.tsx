import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { formatPct } from "@/lib/format";
import type { GoogleNow } from "@/lib/fx/google-view";
import { cn } from "@/lib/utils";

/**
 * Compact "Google USD/LKR" reference for the markets header: the mid-market
 * dollar USDT tracks, and how far this book's mid sits above it.
 */
export function GoogleStrip({ google, mid }: { google: GoogleNow | null; mid: number | null }) {
  if (!google) return null;
  const premium = mid != null ? mid / google.value - 1 : null;
  const stale = google.ageMin > 75;
  return (
    <Link
      href="/rates#google"
      className={cn(
        "group inline-flex min-h-10 items-center gap-3 rounded-lg border px-3 py-1.5 text-xs transition-colors hover:bg-muted/50",
        stale && "border-[color:var(--color-warn)]",
      )}
    >
      <span className="flex flex-col leading-tight">
        <span className="text-muted-foreground">Google USD/LKR</span>
        <span className="font-mono text-sm font-semibold tabular-nums">
          {google.value.toFixed(2)}
          {google.change != null && (
            <span
              className={cn(
                "ml-1.5 text-[11px] font-normal",
                google.change > 0 && "text-[color:var(--color-buy)]",
                google.change < 0 && "text-[color:var(--color-sell)]",
              )}
            >
              {formatPct(google.change, { frac: 2, sign: true })}
            </span>
          )}
        </span>
      </span>
      {premium != null && (
        <span className="flex flex-col border-l pl-3 leading-tight">
          <span className="text-muted-foreground">USDT premium</span>
          <span className="font-mono text-sm font-semibold tabular-nums">{formatPct(premium, { frac: 2, sign: true })}</span>
        </span>
      )}
      <ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      <span className="sr-only">{stale ? `Google rate is ${google.ageMin} minutes old. ` : ""}Open the exchange-rates page</span>
    </Link>
  );
}
