/**
 * Post-sign-in redirect target from `?next=`. Only same-site paths are
 * allowed: must start with a single "/", no "//" or "/\" (protocol-relative),
 * no control characters, and never back into the auth pages.
 */
export function safeNext(raw: string | string[] | null | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || typeof v !== "string") return null;
  if (v.length > 512) return null;
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(v)) return null;
  try {
    const u = new URL(v, "https://p2p.invalid");
    if (u.origin !== "https://p2p.invalid") return null;
    if (/^\/(sign-in|sign-up|verify|forgot-password)(\/|$)/.test(u.pathname)) return null;
    // Dot segments can collapse into a protocol-relative path after parsing
    // ("/.//evil.com" → "//evil.com"), so check the normalized result too.
    if (u.pathname.startsWith("//")) return null;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return null;
  }
}

/** One query-string value from Next's searchParams. */
export function param(raw: string | string[] | undefined): string {
  return (Array.isArray(raw) ? raw[0] : raw) ?? "";
}
