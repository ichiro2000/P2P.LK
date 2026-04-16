import { ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { MerchantFlag } from "@/lib/risk";
import { cn } from "@/lib/utils";

export function MerchantFlags({ flags }: { flags: MerchantFlag[] }) {
  if (flags.length === 0) {
    return (
      <Card className="card-lift border-border bg-card/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Flagged merchants
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldAlert
              className="h-3.5 w-3.5 text-[color:var(--color-buy)]"
              strokeWidth={1.75}
            />
            No counterparties currently flagged at top of book.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="card-lift border-border bg-card/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Flagged merchants
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pb-4">
        {flags.map((f, i) => (
          <div
            key={`${f.merchantId}-${i}`}
            className="flex items-start justify-between gap-3 rounded-md border border-border/60 bg-card/40 px-3 py-2"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground">
                  {f.merchantName}
                </span>
                <Badge
                  variant="outline"
                  className={cn(
                    "h-4 text-[9px] font-semibold uppercase tracking-wider",
                    f.level === "alert"
                      ? "border-[color:var(--color-sell)]/40 text-[color:var(--color-sell)]"
                      : "border-[color:var(--color-warn)]/40 text-[color:var(--color-warn)]",
                  )}
                >
                  {f.level}
                </Badge>
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {f.reason}
              </div>
            </div>
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
              {f.metric}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
