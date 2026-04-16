import { Bell } from "lucide-react";
import { ComingSoon } from "@/components/shell/coming-soon";

export const metadata = { title: "Alerts" };

export default function AlertsPage() {
  return (
    <ComingSoon
      title="Alerts"
      subtitle="Coming in v2"
      icon={Bell}
      description="Get notified when price, spread or a specific merchant moves — via in-app, email or webhook. Alerts run against the live feed with sub-minute granularity."
      bullets={[
        "Price above / below a target",
        "Premium exceeds threshold",
        "Arbitrage opportunity appears",
        "A merchant posts a new ad or shifts price sharply",
        "Liquidity drops below a floor",
        "Unusual market movement detected",
      ]}
    />
  );
}
