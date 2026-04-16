import { BarChart3 } from "lucide-react";
import { ComingSoon } from "@/components/shell/coming-soon";

export const metadata = { title: "Reports" };

export default function ReportsPage() {
  return (
    <ComingSoon
      title="Reports"
      subtitle="Coming in v2"
      icon={BarChart3}
      description="Exportable market reports — daily recaps, merchant scorecards, arbitrage summaries and compliance-ready trade logs."
      bullets={[
        "Daily market recap (all tracked fiats)",
        "Per-merchant scorecard",
        "Arbitrage summary & backtest",
        "Rail-level competitiveness report",
        "Compliance-ready trade logs",
        "PDF / CSV export",
      ]}
    />
  );
}
