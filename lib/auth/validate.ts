/**
 * Onboarding field rules, shared by the sign-up form (client) and the auth
 * server hooks (authoritative).
 */

/** Sri Lankan mobile → E.164 "+947XXXXXXXX", or null when invalid.
 *  Accepts "077 123 4567", "0771234567", "94771234567", "+94 77 123 4567". */
export function normalizeLkMobile(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  let local: string | null = null;
  if (/^\+947\d{8}$/.test(digits)) local = digits.slice(3);
  else if (/^947\d{8}$/.test(digits)) local = digits.slice(2);
  else if (/^07\d{8}$/.test(digits)) local = digits.slice(1);
  else if (/^7\d{8}$/.test(digits)) local = digits;
  return local ? `+94${local}` : null;
}

const PROFILE_HOSTS = {
  binance: /(^|\.)binance\.com$/i,
  bybit: /(^|\.)bybit\.com$/i,
} as const;

/** Optional merchant profile link. Returns "" for empty, null when invalid. */
export function normalizeProfileUrl(raw: string | null | undefined, ex: keyof typeof PROFILE_HOSTS): string | null {
  const v = (raw ?? "").trim();
  if (!v) return "";
  try {
    const u = new URL(v.startsWith("http") ? v : `https://${v}`);
    if (u.protocol !== "https:" || !PROFILE_HOSTS[ex].test(u.hostname)) return null;
    return u.toString().slice(0, 300);
  } catch {
    return null;
  }
}

export const NAME_MAX = 80;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;
