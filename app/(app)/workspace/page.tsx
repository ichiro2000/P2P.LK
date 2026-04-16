import { Briefcase } from "lucide-react";
import { ComingSoon } from "@/components/shell/coming-soon";

export const metadata = { title: "Workspace" };

export default function WorkspacePage() {
  return (
    <ComingSoon
      title="Trader workspace"
      subtitle="Coming in v2"
      icon={Briefcase}
      description="A private dashboard for traders — watchlists for coins, fiats and merchants, saved filters, opportunity trackers, trade notes and exportable history."
      bullets={[
        "Watchlists for coins, fiats and merchants",
        "Saved filters across Live Markets & Arbitrage",
        "Opportunity tracker with history",
        "Personal trade notes & journal",
        "Favourite merchants",
        "Export to CSV / JSON",
      ]}
    />
  );
}
