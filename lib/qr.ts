/**
 * Parse Binance P2P profile identifiers out of a QR-decoded string.
 *
 * Binance's "Share Profile" QR (Share Image on p2p.binance.com) typically
 * encodes one of these URL shapes:
 *
 *   https://p2p.binance.com/en/advertiserDetail?advertiserNo=s0123abcd...
 *   https://www.binance.com/en/p2p/advertiserDetail?advertiserNo=s0123abcd...
 *   https://app.binance.com/en/download?_dp=...&advertiserNo=s0123abcd...
 *   bnc://app.binance.com/payment/secretpay?advertiserNo=s0123abcd...
 *
 * We normalize to the canonical public URL and return the raw advertiserNo
 * as the stable identifier (stays consistent across QR regenerations and
 * across locale prefixes).
 */

export type BinanceProfileRef = {
  /** advertiserNo — the canonical stable identifier. */
  userId: string;
  /** Canonical shareable profile URL. */
  profileUrl: string;
};

const ADVERTISER_QS_KEYS = ["advertiserNo", "advertiserno"] as const;

/** Try to extract a Binance advertiserNo from an arbitrary decoded string. */
export function parseBinanceProfile(raw: string): BinanceProfileRef | null {
  if (!raw) return null;
  const trimmed = raw.trim();

  // Direct URL parse first — handles the happy path.
  const fromUrl = tryParseUrl(trimmed);
  if (fromUrl) return fromUrl;

  // Some QRs encode a deep-link path rather than a URL. Fall back to a
  // regex sweep for the advertiserNo query param anywhere in the string.
  const m = trimmed.match(/advertiser[Nn]o=([A-Za-z0-9_-]+)/);
  if (m) return toRef(m[1]);

  // If the decoded text is itself just the id (alphanumeric), accept it.
  if (/^[Ss]?[A-Za-z0-9]{8,}$/.test(trimmed)) return toRef(trimmed);

  return null;
}

function tryParseUrl(s: string): BinanceProfileRef | null {
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  for (const key of ADVERTISER_QS_KEYS) {
    const v = url.searchParams.get(key);
    if (v) return toRef(v);
  }
  return null;
}

function toRef(userId: string): BinanceProfileRef {
  const clean = userId.trim();
  return {
    userId: clean,
    profileUrl: `https://p2p.binance.com/en/advertiserDetail?advertiserNo=${encodeURIComponent(clean)}`,
  };
}
