import { ShieldAlert } from "lucide-react";
import { ComingSoon } from "@/components/shell/coming-soon";

export const metadata = { title: "Risk" };

export default function RiskPage() {
  return (
    <ComingSoon
      title="Risk & anomaly detection"
      subtitle="Coming in v2"
      icon={ShieldAlert}
      description="Detect abnormal price spikes, fake-looking liquidity, suspected wash-like ad behaviour and dislocated regional markets — with per-merchant trust, anomaly and execution quality scores."
      bullets={[
        "Abnormal price spike detection",
        "Fake-looking liquidity & phantom ads",
        "Merchants churning in and out of top-of-book",
        "Extreme premium vs recent moving average",
        "Low-completion merchants at best price",
        "Trust / anomaly / execution quality per merchant",
      ]}
    />
  );
}
