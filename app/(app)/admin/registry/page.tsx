import { Topbar } from "@/components/shell/topbar";
import { PageBody, PageHeader } from "@/components/common/page";
import { RegistryQueue } from "@/components/admin/registry/registry-queue";
import { loadRegistry, REGISTRY_STATUSES, type RegistryStatus } from "@/lib/db/registry-admin";
import { requireAdminPage } from "@/lib/auth/session";
import { privateMetadata } from "@/lib/seo";

export const metadata = privateMetadata("Admin · Registry");
export const dynamic = "force-dynamic";

// Access: admins only. The page checks itself — the layout's check alone is
// not enough, because a client navigation (RSC request) can render this page
// without re-rendering the layout. The PATCH route checks again.
export default async function AdminRegistryPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[]; q?: string | string[] }>;
}) {
  await requireAdminPage("/admin/registry");
  const sp = await searchParams;
  const raw = Array.isArray(sp.status) ? sp.status[0] : sp.status;
  const tab: RegistryStatus = REGISTRY_STATUSES.includes(raw as RegistryStatus) ? (raw as RegistryStatus) : "pending";
  const q = ((Array.isArray(sp.q) ? sp.q[0] : sp.q) ?? "").trim().slice(0, 100);

  const { counts, rows } = await loadRegistry(tab, q);

  return (
    <>
      <Topbar title="Registry" subtitle="Admin · moderation queue" />
      <PageBody>
        <PageHeader
          eyebrow="Admin"
          title="Suspicious registry"
          description="Member reports wait here until an admin publishes them. Reject or retract with a note; restore anything taken down by mistake. Every decision is logged."
        />
        <RegistryQueue tab={tab} q={q} counts={counts} rows={rows} />
      </PageBody>
    </>
  );
}
