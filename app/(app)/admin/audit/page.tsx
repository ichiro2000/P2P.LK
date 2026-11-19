import Link from "next/link";
import { Topbar } from "@/components/shell/topbar";
import { PageBody, PageHeader } from "@/components/common/page";
import { AuditFilters } from "@/components/admin/audit/audit-filters";
import { AuditList } from "@/components/admin/audit/audit-list";
import { AUDIT_PAGE_SIZE, auditFilterParams, auditTargetTypes, listAudit, parseAuditQuery } from "@/lib/db/audit";
import { requireAdminPage } from "@/lib/auth/session";
import { privateMetadata } from "@/lib/seo";

export const metadata = privateMetadata("Admin · Audit log");
export const dynamic = "force-dynamic";

// Access: admins only. The page checks itself — the layout's check alone is
// not enough, because a client navigation (RSC request) can render this page
// without re-rendering the layout. The CSV export route checks again.
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminPage("/admin/audit");
  const q = parseAuditQuery(await searchParams);
  const [{ rows, olderBefore, newerAfter }, targetTypes] = await Promise.all([listAudit(q), auditTargetTypes()]);

  const filters = auditFilterParams(q);
  const hasFilters = filters.toString() !== "";
  const pageHref = (key: "before" | "after", id: number) => {
    const p = new URLSearchParams(filters);
    p.set(key, String(id));
    return `/admin/audit?${p}`;
  };
  const paged = !!(q.before || q.after);

  return (
    <>
      <Topbar title="Audit log" subtitle="Admin · every admin action" />
      <PageBody>
        <PageHeader
          eyebrow="Admin"
          title="Audit log"
          description={`Every admin decision and account event, newest first, ${AUDIT_PAGE_SIZE} per page. Filters stay in the URL, and Export CSV downloads the current filter.`}
          actions={
            paged ? (
              <Link
                href={`/admin/audit${hasFilters ? `?${filters}` : ""}`}
                className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Back to newest
              </Link>
            ) : undefined
          }
        />
        <AuditFilters q={q} targetTypes={targetTypes} />
        <AuditList
          rows={rows}
          hasFilters={hasFilters}
          olderHref={olderBefore ? pageHref("before", olderBefore) : null}
          newerHref={newerAfter ? pageHref("after", newerAfter) : null}
        />
      </PageBody>
    </>
  );
}
