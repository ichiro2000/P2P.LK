import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/common/empty";
import { formatSLT } from "@/lib/format";
import type { SuspiciousReport } from "@/lib/db/suspicious";
import { ShieldAlert, ExternalLink } from "lucide-react";

/**
 * Server-rendered list of every active report, newest first. Entries are
 * grouped visually by taker so multiple reports on the same advertiserNo
 * read as a single "case" rather than scattered rows.
 */
export function RegistryList({ reports }: { reports: SuspiciousReport[] }) {
  if (reports.length === 0) {
    return (
      <Card className="border-border bg-card/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Registry
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Empty
            icon={ShieldAlert}
            title="No reports yet"
            description="When a community member adds a flagged taker, it shows up here."
          />
        </CardContent>
      </Card>
    );
  }

  const grouped = new Map<string, SuspiciousReport[]>();
  for (const r of reports) {
    const list = grouped.get(r.binanceUserId) ?? [];
    list.push(r);
    grouped.set(r.binanceUserId, list);
  }
  const takers = Array.from(grouped.entries()).sort(
    (a, b) => b[1][0].ts - a[1][0].ts,
  );

  return (
    <Card className="border-border bg-card/60">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Registry
          </CardTitle>
          <span className="font-mono text-[10px] text-muted-foreground">
            {takers.length} taker{takers.length === 1 ? "" : "s"} ·{" "}
            {reports.length} report{reports.length === 1 ? "" : "s"}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pb-4">
        {takers.map(([userId, rs]) => (
          <TakerBlock key={userId} userId={userId} reports={rs} />
        ))}
      </CardContent>
    </Card>
  );
}

function TakerBlock({
  userId,
  reports,
}: {
  userId: string;
  reports: SuspiciousReport[];
}) {
  const head = reports[0];
  return (
    <div className="rounded-md border border-border/60 bg-card/40 px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {head.displayName ?? "Unknown taker"}
            </span>
            <Badge
              variant="outline"
              className="h-4 text-[9px] font-semibold uppercase tracking-wider"
            >
              {reports.length} report{reports.length === 1 ? "" : "s"}
            </Badge>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted-foreground">
            <span>advertiserNo: {userId}</span>
            <a
              href={head.profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline hover:text-foreground"
            >
              Open on Binance <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </div>
      <ul className="mt-2 space-y-2 border-t border-border/60 pt-2">
        {reports.map((r) => (
          <li key={r.id} className="text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className="border-[color:var(--color-sell)]/40 text-[color:var(--color-sell)]"
              >
                {r.reason}
              </Badge>
              <span className="text-muted-foreground">
                {formatSLT(r.ts)} SLT
              </span>
              {r.reporter && (
                <span className="text-muted-foreground">· by {r.reporter}</span>
              )}
            </div>
            {r.notes && (
              <p className="mt-1 text-muted-foreground">{r.notes}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
