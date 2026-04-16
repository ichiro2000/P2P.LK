import { Topbar } from "@/components/shell/topbar";
import { SectionHeader } from "@/components/common/section-header";
import { LiveDot } from "@/components/common/live-dot";
import { Badge } from "@/components/ui/badge";
import { RuleForm } from "@/components/alerts/rule-form";
import { RulesList } from "@/components/alerts/rules-list";
import { EventLog } from "@/components/alerts/event-log";

export const metadata = { title: "Alerts" };

export default function AlertsPage() {
  return (
    <>
      <Topbar title="Alerts" subtitle="Rules and recent events">
        <Badge
          variant="outline"
          className="hidden sm:inline-flex border-dashed bg-transparent text-[10px] text-muted-foreground/80"
        >
          Local
        </Badge>
        <LiveDot label="Checking" className="hidden sm:inline-flex" />
      </Topbar>

      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <SectionHeader
          kicker="Alerts"
          title="Fire a toast when the market crosses a line"
          description="Rules live in your browser and are evaluated against the live feed every 30 seconds while the tab is open. A cooldown prevents the same rule from hammering you. When you deploy and add auth, the same rules sync server-side for background delivery."
        />

        <RuleForm />

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <RulesList />
          <EventLog />
        </div>
      </div>
    </>
  );
}
