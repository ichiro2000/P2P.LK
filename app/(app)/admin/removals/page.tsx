import { Topbar } from "@/components/shell/topbar";
import { SectionHeader } from "@/components/common/section-header";
import { RemovalQueue } from "@/components/admin/removal-queue";

export const metadata = { title: "Admin · Removal requests" };
export const dynamic = "force-dynamic";

export default function AdminRemovalsPage() {
  return (
    <>
      <Topbar title="Removal requests" subtitle="Admin · review queue" />
      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <SectionHeader
          kicker="Admin"
          title="Removal requests"
          description="Public requests to un-flag suspicious takers. Approving a request retracts every active report for that taker in one shot."
        />
        <RemovalQueue />
      </div>
    </>
  );
}
