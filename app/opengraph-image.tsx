import { ImageResponse } from "next/og";
import { OG_CONTENT_TYPE, OG_SIZE, OgFrame } from "@/components/seo/og-frame";

/**
 * Site-wide Open Graph / Twitter image: a real PNG (WhatsApp, Facebook, X
 * and LinkedIn ignore SVG previews). Static: rendered once at build, no data.
 * Next emits og:image and twitter:image for every page that has no closer
 * opengraph-image file.
 */
export const alt = "P2P.LK: USDT/LKR live P2P rates from Binance and Bybit for Sri Lanka";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <OgFrame eyebrow="Sri Lanka · USDT / LKR" title="USDT/LKR live P2P rates">
        <div style={{ display: "flex", marginTop: 28, fontSize: 30, color: "#d4d4d8", maxWidth: 960, lineHeight: 1.35 }}>
          Best Binance and Bybit P2P prices for LKR bank transfers, spread, depth, merchants and the Google dollar rate.
        </div>
      </OgFrame>
    ),
    { ...OG_SIZE },
  );
}
