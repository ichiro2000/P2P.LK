import { LineChart } from "lucide-react";
import { ComingSoon } from "@/components/shell/coming-soon";

export const metadata = { title: "Historical" };

export default function HistoricalPage() {
  return (
    <ComingSoon
      title="Historical analytics"
      subtitle="Coming in v2"
      icon={LineChart}
      description="Track Binance P2P prices over time — hourly, daily and weekly averages, premium vs spot, volatility by payment rail, and candle-style charts for individual markets."
      bullets={[
        "Hourly / daily / weekly price series per market",
        "Premium vs Binance spot price over time",
        "Volatility by fiat and payment method",
        "Moving averages (MA20 / MA100 / MA200)",
        "Candle-style and line charts",
        "Price distribution — not just top-of-book",
      ]}
    />
  );
}
