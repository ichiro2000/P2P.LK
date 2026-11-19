import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { MerchantFlag } from "@/lib/risk";
import { cn } from "@/lib/utils";

/** Counterparties flagged at top of book. Card list on every width. */
export function MerchantFlags({ flags }: { flags: MerchantFlag[] }) {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm font-medium">Flagged merchants</CardTitle>
        <CardDescription className="text-xs">
          Merchants holding the best price with a completion rate under 90%.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        {flags.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="size-4 text-[color:var(--color-buy)]" strokeWidth={1.75} aria-hidden />
            No counterparties flagged at top of book right now.
          </div>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {flags.map((f, i) => (
              <li
                key={`${f.merchantId}-${i}`}
                className="flex items-start justify-between gap-3 rounded-md border px-3 py-2.5"
              >
                <div className="min-w-0 space-y-0.5">
                  <Link
                    href={`/merchants/${encodeURIComponent(f.merchantId)}`}
                    className="block truncate text-sm font-medium hover:underline"
                  >
                    {f.merchantName}
                  </Link>
                  <div className="text-[11px] text-muted-foreground">{f.reason}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge
                    variant="outline"
                    className={cn(
                      "h-5 text-[10px] uppercase tracking-wide",
                      f.level === "alert"
                        ? "border-[color:var(--color-sell)]/40 text-[color:var(--color-sell)]"
                        : "border-[color:var(--color-warn)]/40 text-[color:var(--color-warn)]",
                    )}
                  >
                    {f.level}
                  </Badge>
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{f.metric}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
