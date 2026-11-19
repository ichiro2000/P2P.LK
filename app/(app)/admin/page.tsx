import { Topbar } from "@/components/shell/topbar";
import { PageBody, PageHeader } from "@/components/common/page";
import { requireAdminPage } from "@/lib/auth/session";
import { formatSLT } from "@/lib/format";
import { loadOverview } from "@/components/admin/overview/data";
import { RefreshButton } from "@/components/admin/overview/refresh-button";
import {
  DatabaseSection,
  IngestSection,
  RegistrySection,
  UsersSection,
} from "@/components/admin/overview/sections";
import { privateMetadata } from "@/lib/seo";

export const metadata = privateMetadata("Admin · Overview");
export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  // The layout guards too; pages re-check because a layout isn't re-run on
  // client-side navigation between admin pages.
  await requireAdminPage("/admin");
  const o = await loadOverview();

  return (
    <>
      <Topbar title="Admin" subtitle="Overview" />
      <PageBody>
        <PageHeader
          eyebrow="Admin"
          title="Overview"
          description={`Users, ingest health, the registry and the database. As of ${formatSLT(o.now, { dateStyle: undefined, timeStyle: "medium" })} SLT.`}
          actions={<RefreshButton />}
        />
        <UsersSection users={o.users} />
        <IngestSection ingest={o.ingest} now={o.now} />
        <RegistrySection registry={o.registry} />
        <DatabaseSection database={o.database} />
      </PageBody>
    </>
  );
}
