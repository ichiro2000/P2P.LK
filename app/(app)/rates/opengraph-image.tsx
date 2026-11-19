import { ImageResponse } from "next/og";
import { OG_CONTENT_TYPE, OG_SIZE, OgFrame, OgStat } from "@/components/seo/og-frame";
import { latestGoogle, p2pVsGoogle } from "@/lib/fx/google-view";
import { EXCHANGES } from "@/lib/exchanges";
import { formatSLT } from "@/lib/format";

/**
 * Live share image for /rates: the USDT/LKR buy price on each exchange (KV
 * book, no upstream call) next to Google's USD/LKR (one D1 row). Rendered
 * per request and cached at the edge for 5 minutes, so a link shared in a
 * WhatsApp group shows a recent price without hammering the Worker.
 */
export const alt = "Live USDT/LKR P2P price on Binance and Bybit next to the Google USD/LKR rate";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const dynamic = "force-dynamic";

const rs = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "n/a" : `Rs ${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function RatesOpenGraphImage() {
  const google = await latestGoogle().catch(() => null);
  const p2p = await p2pVsGoogle(google?.value ?? null).catch(() => []);
  const stamp = formatSLT(new Date(), { dateStyle: "medium", timeStyle: "short" });

  return new ImageResponse(
    (
      <OgFrame eyebrow="USDT to LKR rate today" title="Live P2P vs Google dollar rate" footer={`As of ${stamp} SLT · buy price, best merchant ad`}>
        <div style={{ display: "flex", gap: 48, marginTop: 48 }}>
          {p2p.map((q) => (
            <OgStat key={q.exchange} label={`${EXCHANGES[q.exchange].label} P2P · buy USDT`} value={rs(q.buy)} />
          ))}
          <OgStat label="Google USD/LKR" value={rs(google?.value)} />
        </div>
      </OgFrame>
    ),
    {
      ...OG_SIZE,
      headers: { "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=600" },
    },
  );
}
