import { ICON_TEXT, LK_TEXT, LOGO } from "@/lib/brand";
/**
 * Shared 1200x630 frame for next/og images. Satori renders inline styles
 * only (no Tailwind, no CSS variables), so the black/white brand colours are
 * literal here. Uses ImageResponse's bundled default font: no font fetch,
 * nothing extra in the Worker bundle.
 */

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

const INK = "#0a0a0a";
const PAPER = "#ffffff";
const MUTED = "#a1a1aa";
const RULE = "#27272a";

/** The logo (lib/brand), inverted for the dark frame: paper box with ink
 *  "P2P", paper ".LK". */
function Logo() {
  // Inverted for the dark frame: white rectangle, black "P2P" and ".lk".
  const h = 80;
  const w = Math.round((h * LOGO.width) / LOGO.height);
  const b = LOGO.box;
  return (
    <svg width={w} height={h} viewBox={LOGO.viewBox}>
      <rect width={b.width} height={b.height} rx={b.rx} fill={PAPER} />
      <path transform={LOGO.p2p} d={ICON_TEXT} fill={INK} />
      <path transform={LOGO.lk} d={LK_TEXT} fill={INK} />
    </svg>
  );
}

export function OgFrame({
  eyebrow,
  title,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
  footer?: string;
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: INK,
        color: PAPER,
        padding: "64px 80px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <Logo />
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 56, gap: 16 }}>
        <div style={{ display: "flex", fontSize: 26, color: MUTED, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          {eyebrow}
        </div>
        <div style={{ display: "flex", fontSize: 72, fontWeight: 700, lineHeight: 1.05, letterSpacing: "-0.03em" }}>
          {title}
        </div>
      </div>
      {children}
      <div
        style={{
          marginTop: "auto",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderTop: `2px solid ${RULE}`,
          paddingTop: 24,
          fontSize: 24,
          color: MUTED,
        }}
      >
        <div style={{ display: "flex" }}>{footer ?? "Binance P2P and Bybit P2P · LKR bank transfers"}</div>
        <div style={{ display: "flex", color: PAPER, fontWeight: 700 }}>p2p.lk</div>
      </div>
    </div>
  );
}

/** One big number with a label, for the live images. */
export function OgStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 300 }}>
      <div style={{ display: "flex", fontSize: 24, color: MUTED }}>{label}</div>
      <div style={{ display: "flex", fontSize: 54, fontWeight: 700, letterSpacing: "-0.02em" }}>{value}</div>
    </div>
  );
}
