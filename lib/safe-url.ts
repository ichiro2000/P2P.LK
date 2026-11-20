/**
 * Only https:// links may become an href when the URL came from users or
 * decoded QR content. Anything else (javascript:, data:, http:, app
 * schemes) renders as plain text instead.
 */
export function safeHttpsUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const p = new URL(u.trim());
    return p.protocol === "https:" && !p.username && !p.password ? p.toString() : null;
  } catch {
    return null;
  }
}
