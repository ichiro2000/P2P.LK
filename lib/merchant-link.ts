/**
 * Pull the advertiser id out of a member's own Binance / Bybit profile link.
 * Pure (no server imports) so the account form can preview the match too.
 *
 * Binance (id = `advertiserNo`, what the ingest stores as merchant id):
 *   https://p2p.binance.com/en/advertiserDetail?advertiserNo=s0123abcd…
 *   https://www.binance.com/en/p2p/advertiserDetail?advertiserNo=s0123abcd…
 *   …?merchantNo= / ?userNo= variants from the share QR (see lib/qr.ts)
 *   Short links (s.binance.com/AbC123) carry no id → null.
 *
 * Bybit (id = the public `s…` mask id, what the ingest stores):
 *   https://www.bybit.com/en/p2p/profile/<id>/USDT/LKR/item
 *   https://www.bybit.com/fiat/trade/otc/profile/<id>/USDT/LKR/item
 *   …?userId=<id> on some share links
 */

import { parseBinanceProfile } from "@/lib/qr";
import type { ExchangeId } from "@/lib/exchanges/types";

const ID_RE = /^[A-Za-z0-9_-]{4,64}$/;

export function binanceAdvertiserId(url: string | null | undefined): string | null {
  if (!url) return null;
  const ref = parseBinanceProfile(url);
  if (!ref) return null;
  // Short-link / whole-URL fallbacks contain "/" or "." — not a real id.
  return ID_RE.test(ref.userId) ? ref.userId : null;
}

export function bybitAdvertiserId(url: string | null | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url.startsWith("http") ? url : `https://${url}`);
  } catch {
    return null;
  }
  if (!/(^|\.)bybit\.com$/i.test(u.hostname)) return null;
  const segs = u.pathname.split("/").filter(Boolean);
  const i = segs.findIndex((s) => s.toLowerCase() === "profile");
  if (i >= 0 && segs[i + 1]) {
    let id = "";
    try {
      id = decodeURIComponent(segs[i + 1]);
    } catch {
      // Malformed %-escape: not an id. Fall through to the query params.
    }
    if (ID_RE.test(id)) return id;
  }
  for (const k of ["userId", "userid", "uid", "advertiserId", "makerId"]) {
    const v = u.searchParams.get(k)?.trim();
    if (v && ID_RE.test(v)) return v;
  }
  return null;
}

export type LinkedAdvertiser = { exchange: ExchangeId; id: string };

/** Every advertiser id we can read from the member's profile links. */
export function linkedAdvertisers(v: { binanceUrl: string | null; bybitUrl: string | null }): LinkedAdvertiser[] {
  const out: LinkedAdvertiser[] = [];
  const b = binanceAdvertiserId(v.binanceUrl);
  if (b) out.push({ exchange: "binance", id: b });
  const y = bybitAdvertiserId(v.bybitUrl);
  if (y) out.push({ exchange: "bybit", id: y });
  return out;
}
