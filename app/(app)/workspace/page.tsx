import { Topbar } from "@/components/shell/topbar";
import { PageBody, PageHeader } from "@/components/common/page";
import { StorageBadge } from "@/components/members/storage-badge";
import { WorkspacePanel } from "@/components/workspace/workspace-panel";
import { privateMetadata } from "@/lib/seo";

export const metadata = privateMetadata("Workspace", "follow");

export default function WorkspacePage() {
  return (
    <>
      <Topbar title="Workspace" subtitle="Your private dashboard" />
      <PageBody>
        <PageHeader
          title="Markets, merchants and filters you care about"
          description="Star markets and merchants anywhere in the app, save filters, and come back here to jump straight to them. No account needed: guests keep this in the browser, members get it synced to every device."
          actions={<StorageBadge />}
        />
        <WorkspacePanel />
      </PageBody>
    </>
  );
}
