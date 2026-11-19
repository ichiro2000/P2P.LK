import { Topbar } from "@/components/shell/topbar";
import { PageBody, PageHeader } from "@/components/common/page";
import { requireAdminPage } from "@/lib/auth/session";
import { MemberQueue, RecentAdminActions } from "@/components/admin/members/member-queue";
import { loadMembers, MEMBER_TABS, type MemberTab } from "@/components/admin/members/data";
import { privateMetadata } from "@/lib/seo";

export const metadata = privateMetadata("Admin · Members");
export const dynamic = "force-dynamic";

export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[]; q?: string | string[] }>;
}) {
  const viewer = await requireAdminPage("/admin/members");
  const sp = await searchParams;
  const raw = Array.isArray(sp.status) ? sp.status[0] : sp.status;
  const tab: MemberTab = MEMBER_TABS.some((t) => t.key === raw) ? (raw as MemberTab) : "pending_review";
  const q = ((Array.isArray(sp.q) ? sp.q[0] : sp.q) ?? "").trim().slice(0, 100);

  const { counts, members, admins, audit } = await loadMembers(tab, q);

  return (
    <>
      <Topbar title="Members" subtitle="Admin · review queue" />
      <PageBody>
        <PageHeader
          eyebrow="Admin"
          title="Members"
          description="Approve or reject new merchants, suspend accounts and manage admins. Every action is logged and the member is emailed on approval or rejection."
        />
        <MemberQueue tab={tab} q={q} counts={counts} members={members} admins={admins} viewerId={viewer.id} />
        <RecentAdminActions rows={audit} />
      </PageBody>
    </>
  );
}
