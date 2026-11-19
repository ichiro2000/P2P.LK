import { Topbar } from "@/components/shell/topbar";
import { PageBody, PageHeader } from "@/components/common/page";
import { RemovalQueue } from "@/components/admin/removal-queue";
import { requireAdminPage } from "@/lib/auth/session";
import { privateMetadata } from "@/lib/seo";

export const metadata = privateMetadata("Admin · Removal requests");
export const dynamic = "force-dynamic";

// Access: admins only, checked here as well as in the layout (an RSC
// navigation can render this page without the layout). The queue's API
// routes check again.
export default async function AdminRemovalsPage() {
  await requireAdminPage("/admin/removals");
  return (
    <>
      <Topbar title="Removal requests" subtitle="Admin · review queue" />
      <PageBody>
        <PageHeader
          eyebrow="Admin"
          title="Removal requests"
          description="Public requests to un-flag suspicious takers. Approving a request retracts every active report for that taker at once."
        />
        <RemovalQueue />
      </PageBody>
    </>
  );
}
