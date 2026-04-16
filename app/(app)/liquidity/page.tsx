import { Droplets } from "lucide-react";
import { ComingSoon } from "@/components/shell/coming-soon";

export const metadata = { title: "Liquidity" };

export default function LiquidityPage() {
  return (
    <ComingSoon
      title="Liquidity analytics"
      subtitle="Coming in v2"
      icon={Droplets}
      description="Raw prices only tell half the story. This view answers whether you can actually fill your size, and whether the visible book is real or theatre."
      bullets={[
        "Total volume by market and time-of-day heatmap",
        "Volume concentration by merchant",
        "Average order size distribution",
        "Slippage estimate for a given target size",
        "Ads near best price count",
        "Composite liquidity score per market",
      ]}
    />
  );
}
