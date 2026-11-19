import Link from "next/link";
import { ChevronLeft, ChevronRight, ScrollText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Empty } from "@/components/common/empty";
import { formatSLT } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AuditEntry } from "@/lib/db/audit";

/* ── Pieces ──────────────────────────────────────────────────────────── */

function actionTone(action: string): string {
  if (action.startsWith("registry.removal."))
    return "border-[color:var(--color-warn)]/40 bg-[color:var(--color-warn)]/10 text-[color:var(--color-warn)]";
  if (/\.(reject|retract|suspend|remove_admin)$/.test(action))
    return "border-[color:var(--color-sell)]/40 bg-[color:var(--color-sell)]/10 text-[color:var(--color-sell)]";
  if (/\.(approve|publish|restore|unsuspend|make_admin)$/.test(action))
    return "border-[color:var(--color-buy)]/40 bg-[color:var(--color-buy)]/10 text-[color:var(--color-buy)]";
  if (action.startsWith("registry."))
    return "border-[color:var(--color-warn)]/40 bg-[color:var(--color-warn)]/10 text-[color:var(--color-warn)]";
  return "border-border bg-muted/50 text-foreground";
}

function ActionBadge({ action }: { action: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 max-w-full items-center truncate rounded-full border px-2 font-mono text-xs font-medium",
        actionTone(action),
      )}
      title={action}
    >
      {action}
    </span>
  );
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/** Where a target lives in the app, if anywhere. */
function targetHref(r: AuditEntry): string | null {
  const d = r.detail ?? {};
  if (r.targetType === "user") {
    const q = str(d.email) ?? r.targetId;
    return q ? `/admin/members?q=${encodeURIComponent(q)}` : null;
  }
  if (r.targetType === "suspicious_report") {
    const taker = str(d.userId);
    // Active reports have a public page; anything else lives in the queue.
    if (taker && (d.to === "active" || r.action === "registry.publish"))
      return `/suspicious/${encodeURIComponent(taker)}`;
    return r.targetId ? `/admin/registry?status=${encodeURIComponent(str(d.to) ?? "pending")}&q=${encodeURIComponent(r.targetId)}` : null;
  }
  if (r.targetType === "removal_request") return "/admin/removals";
  return null;
}

function Target({ r }: { r: AuditEntry }) {
  if (!r.targetType && !r.targetId) return <span className="text-muted-foreground">—</span>;
  const d = r.detail ?? {};
  const label = str(d.email) ?? (r.targetType === "suspicious_report" && r.targetId ? `#${r.targetId}` : r.targetId);
  const href = targetHref(r);
  return (
    <span className="block min-w-0">
      <span className="block text-xs text-muted-foreground">{r.targetType ?? "—"}</span>
      {href ? (
        <Link href={href} className="block font-mono text-xs break-all underline-offset-2 hover:underline">
          {label}
        </Link>
      ) : (
        <span className="block font-mono text-xs break-all">{label ?? "—"}</span>
      )}
    </span>
  );
}

function Detail({ r }: { r: AuditEntry }) {
  if (!r.detail || Object.keys(r.detail).length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  const note = str(r.detail.note);
  return (
    <details className="group min-w-0">
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
        <span className="truncate">{note ? `“${note}”` : "Details"}</span>
      </summary>
      <pre className="mt-1 max-h-80 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
        {JSON.stringify(r.detail, null, 2)}
      </pre>
    </details>
  );
}

const Time = ({ ts }: { ts: number }) => (
  <span className="font-mono text-xs whitespace-nowrap tabular-nums">{formatSLT(ts, { dateStyle: "short", timeStyle: "medium" })}</span>
);

/* ── List ────────────────────────────────────────────────────────────── */

export function AuditList({
  rows,
  olderHref,
  newerHref,
  hasFilters,
}: {
  rows: AuditEntry[];
  olderHref: string | null;
  newerHref: string | null;
  hasFilters: boolean;
}) {
  if (rows.length === 0) {
    return (
      <Empty
        icon={ScrollText}
        title={hasFilters ? "No entries match these filters" : "No audit entries yet"}
        description={hasFilters ? "Try a wider date range or clear a filter." : undefined}
      />
    );
  }

  return (
    <div className="space-y-3">
      {/* Phones / tablets: cards */}
      <ul className="grid grid-cols-1 gap-3 lg:hidden">
        {rows.map((r) => (
          <li key={r.id}>
            <Card className="gap-2 px-4 py-3">
              <div className="flex items-center justify-between gap-3 text-muted-foreground">
                <Time ts={r.ts} />
                <span className="font-mono text-xs tabular-nums">#{r.id}</span>
              </div>
              <div className="min-w-0 space-y-1">
                <ActionBadge action={r.action} />
                <div className="text-sm break-all">{r.actorEmail ?? <span className="text-muted-foreground">system</span>}</div>
              </div>
              <Target r={r} />
              <Detail r={r} />
            </Card>
          </li>
        ))}
      </ul>

      {/* Desktop: table */}
      <Card className="hidden py-0 lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-44 pl-4">Time (SLT)</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Target</TableHead>
              <TableHead className="pr-4">Detail</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className="align-top">
                <TableCell className="pl-4">
                  <Time ts={r.ts} />
                  <div className="font-mono text-xs text-muted-foreground tabular-nums">#{r.id}</div>
                </TableCell>
                <TableCell className="max-w-56 text-sm break-all whitespace-normal">
                  {r.actorEmail ?? <span className="text-muted-foreground">system</span>}
                </TableCell>
                <TableCell className="max-w-56">
                  <ActionBadge action={r.action} />
                </TableCell>
                <TableCell className="max-w-56 whitespace-normal">
                  <Target r={r} />
                </TableCell>
                <TableCell className="max-w-md min-w-56 pr-4 whitespace-normal">
                  <Detail r={r} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <nav aria-label="Audit pages" className="flex items-center justify-between gap-2">
        {newerHref ? (
          <Link href={newerHref} className={cn(buttonVariants({ variant: "outline" }), "h-10 sm:h-9")}>
            <ChevronLeft /> Newer
          </Link>
        ) : (
          <span />
        )}
        {olderHref ? (
          <Link href={olderHref} className={cn(buttonVariants({ variant: "outline" }), "h-10 sm:h-9")}>
            Older <ChevronRight />
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground">End of log</span>
        )}
      </nav>
    </div>
  );
}
