import Link from "next/link";
import { Download, Filter, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ACTION_PREFIXES, AUDIT_EXPORT_CAP, auditFilterParams, type AuditQuery } from "@/lib/db/audit";

const FIELD = "h-10 sm:h-9 dark:scheme-dark";
const SELECT =
  "h-10 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 text-base text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-9 md:text-sm dark:bg-input/30 dark:scheme-dark";

/** Plain GET form: every filter lives in the URL, so views are shareable and
 *  the page stays a server component. */
export function AuditFilters({ q, targetTypes }: { q: AuditQuery; targetTypes: string[] }) {
  const active = auditFilterParams(q);
  const hasFilters = active.toString() !== "";
  const exportHref = `/api/admin/audit/export${hasFilters ? `?${active}` : ""}`;
  // Keep a filtered-on value selectable even if it's not in the list.
  const types = q.targetType && !targetTypes.includes(q.targetType) ? [...targetTypes, q.targetType] : targetTypes;

  return (
    <Card className="gap-3 px-4 py-4">
      <form action="/admin/audit" method="get" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <div className="space-y-1.5">
          <Label htmlFor="audit-action">Action</Label>
          <select id="audit-action" name="action" defaultValue={q.action ?? ""} className={SELECT}>
            <option value="">All actions</option>
            {ACTION_PREFIXES.map((p) => (
              <option key={p} value={p}>
                {p}*
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="audit-actor">Actor email</Label>
          <Input id="audit-actor" name="actor" type="search" defaultValue={q.actor ?? ""} placeholder="Contains…" maxLength={200} className={FIELD} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="audit-ttype">Target type</Label>
          <select id="audit-ttype" name="targetType" defaultValue={q.targetType ?? ""} className={SELECT}>
            <option value="">Any target</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="audit-tid">Target id</Label>
          <Input id="audit-tid" name="targetId" type="search" defaultValue={q.targetId ?? ""} placeholder="Exact id" maxLength={200} className={cn(FIELD, "font-mono")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="audit-from">From (SLT)</Label>
          <Input id="audit-from" name="from" type="date" defaultValue={q.from ?? ""} className={FIELD} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="audit-to">To (SLT)</Label>
          <Input id="audit-to" name="to" type="date" defaultValue={q.to ?? ""} className={FIELD} />
        </div>
        <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row sm:items-center lg:col-span-3 xl:col-span-6">
          <Button type="submit" className="h-10 sm:h-9">
            <Filter /> Apply filters
          </Button>
          {hasFilters && (
            <Link href="/admin/audit" className={cn(buttonVariants({ variant: "ghost" }), "h-10 sm:h-9")}>
              <X /> Clear
            </Link>
          )}
          <a
            href={exportHref}
            download
            className={cn(buttonVariants({ variant: "outline" }), "h-10 sm:ml-auto sm:h-9")}
            title={`Up to ${AUDIT_EXPORT_CAP.toLocaleString("en-US")} rows of the current filter`}
          >
            <Download /> Export CSV
          </a>
        </div>
      </form>
    </Card>
  );
}
