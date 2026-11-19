import { ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatSLT } from "@/lib/format";
import type { LatestRate } from "@/lib/fx/queries";
import type { SourceInfo } from "@/lib/fx/overview";
import { cn } from "@/lib/utils";
import { formatDay } from "./model";

/** Sources we reviewed but don't collect, and why (details in lib/fx/SOURCES.md). */
const SKIPPED: { name: string; reason: string }[] = [
  { name: "Bank of Ceylon", reason: "website terms forbid automated access and storing content" },
  { name: "Seylan Bank", reason: "website terms forbid reusing content outside their site" },
  { name: "Pan Asia Bank", reason: "page sits behind a bot-check challenge" },
  { name: "Union Bank", reason: "page sits behind a bot-check challenge" },
  { name: "NSB", reason: "site refuses automated clients" },
  { name: "Cargills Bank", reason: "rates need a per-visit session token" },
  { name: "HSBC Sri Lanka", reason: "rates published as a daily PDF only" },
];

/** Server component: attribution + freshness for every source. */
export function SourcesList({ sources, latest }: { sources: SourceInfo[]; latest: LatestRate[] }) {
  const asOfBy = new Map<string, string>();
  for (const r of latest) {
    const cur = asOfBy.get(r.source);
    if (!cur || r.asOf > cur) asOfBy.set(r.source, r.asOf);
  }

  return (
    <div className="space-y-3">
      <Card className="gap-0 divide-y p-0">
        {sources.map((s) => {
          const asOf = asOfBy.get(s.id);
          const failing = s.lastOk === false;
          return (
            <div key={s.id} className="flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <a
                  href={s.pageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
                >
                  Source: {s.name}
                  <ExternalLink className="size-3 text-muted-foreground" />
                </a>
                {failing && s.error && (
                  <div className="truncate text-[11px] text-[color:var(--color-warn)]">Last check failed: {s.error}</div>
                )}
              </div>
              <div className={cn("shrink-0 text-xs tabular-nums text-muted-foreground")}>
                {asOf ? `as of ${formatDay(asOf)}` : "no data yet"}
                {s.lastOkTs ? ` · checked ${formatSLT(s.lastOkTs)} SLT` : ""}
              </div>
            </div>
          );
        })}
      </Card>
      <div className="space-y-1.5 text-[11px] text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">Rates are indicative.</span> They are copied as published by each
          institution, checked every 3 hours, and may change during the day. Banks apply commissions and negotiate rates for
          large amounts. Always confirm with your bank before transacting. P2P.LK collects these numbers itself from the
          sources above; we don&apos;t use third-party rate aggregators.
        </p>
        <p>
          Not included: {SKIPPED.map((s, i) => (
            <span key={s.name}>
              {s.name} ({s.reason}){i < SKIPPED.length - 1 ? "; " : "."}
            </span>
          ))}
        </p>
      </div>
    </div>
  );
}
