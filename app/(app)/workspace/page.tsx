import { Topbar } from "@/components/shell/topbar";
import { SectionHeader } from "@/components/common/section-header";
import { WorkspacePanel } from "@/components/workspace/workspace-panel";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Workspace" };

export default function WorkspacePage() {
  return (
    <>
      <Topbar title="Workspace" subtitle="Your private dashboard">
        <Badge
          variant="outline"
          className="hidden sm:inline-flex border-dashed bg-transparent text-[10px] text-muted-foreground/80"
        >
          Local
        </Badge>
      </Topbar>

      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <SectionHeader
          kicker="Your workspace"
          title="Markets, merchants and filters you care about"
          description="Everything here lives in your browser only — no account needed. Star markets and merchants from anywhere in the app, save filter configurations, and come back here to jump straight to them."
        />

        <WorkspacePanel />
      </div>
    </>
  );
}
