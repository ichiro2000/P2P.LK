import "server-only";
import { headers } from "next/headers";
import { and, desc, eq, gt } from "drizzle-orm";
import { getAuth } from "@/lib/auth/config";
import { getDb, schema } from "@/lib/db/client";

/**
 * Account page data. Sessions are read straight from D1 (scoped to the
 * viewer) instead of Better Auth's /list-sessions, which refuses sessions
 * older than `freshAge` (1 day) — most members would see an error there.
 * Tokens never leave the server: the client gets session ids only, and
 * revoking goes through a server action that looks the token up again.
 */

export type DeviceSession = {
  id: string;
  device: string;
  browser: string;
  os: string;
  mobile: boolean;
  ip: string | null;
  /** ms since epoch */
  createdAt: number;
  updatedAt: number;
  current: boolean;
};

/** Current session id for this request, or null. */
export async function currentSessionId(): Promise<string | null> {
  try {
    const auth = await getAuth();
    const s = await auth.api.getSession({ headers: await headers() });
    return s?.session.id ?? null;
  } catch {
    return null;
  }
}

export async function listDeviceSessions(userId: string): Promise<DeviceSession[]> {
  const [db, currentId] = await Promise.all([getDb(), currentSessionId()]);
  const s = schema.session;
  const rows = await db
    .select({
      id: s.id,
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    })
    .from(s)
    .where(and(eq(s.userId, userId), gt(s.expiresAt, new Date())))
    .orderBy(desc(s.updatedAt))
    .limit(50);
  return rows
    .map((r) => {
      const ua = parseUserAgent(r.userAgent);
      return {
        id: r.id,
        ...ua,
        ip: r.ipAddress || null,
        createdAt: new Date(r.createdAt).getTime(),
        updatedAt: new Date(r.updatedAt).getTime(),
        current: r.id === currentId,
      };
    })
    .sort((a, b) => Number(b.current) - Number(a.current));
}

/** Session token for one of the viewer's own sessions (server only). */
export async function sessionTokenFor(userId: string, sessionId: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.query.session.findFirst({
    where: and(eq(schema.session.id, sessionId), eq(schema.session.userId, userId)),
    columns: { token: true },
  });
  return row?.token ?? null;
}

/** Small, dependency-free UA parser: good enough for "Chrome on Android". */
export function parseUserAgent(ua: string | null | undefined): {
  device: string;
  browser: string;
  os: string;
  mobile: boolean;
} {
  const s = ua ?? "";
  if (!s) return { device: "Unknown device", browser: "Unknown browser", os: "", mobile: false };

  const os = /Windows NT/i.test(s)
    ? "Windows"
    : /iPhone/i.test(s)
      ? "iPhone"
      : /iPad/i.test(s)
        ? "iPad"
        : /Android/i.test(s)
          ? "Android"
          : /CrOS/i.test(s)
            ? "ChromeOS"
            : /Mac OS X|Macintosh/i.test(s)
              ? "macOS"
              : /Linux/i.test(s)
                ? "Linux"
                : "";

  const browser = /EdgA?\/|Edg\//i.test(s)
    ? "Edge"
    : /OPR\/|Opera/i.test(s)
      ? "Opera"
      : /SamsungBrowser/i.test(s)
        ? "Samsung Internet"
        : /FxiOS|Firefox\//i.test(s)
          ? "Firefox"
          : /CriOS|Chrome\//i.test(s)
            ? "Chrome"
            : /Safari\//i.test(s)
              ? "Safari"
              : /curl|node|undici|bot/i.test(s)
                ? "Script"
                : "Browser";

  const mobile = /Mobi|iPhone|Android(?!.*Tablet)/i.test(s) && !/iPad/i.test(s);
  return { device: os ? `${browser} on ${os}` : browser, browser, os, mobile };
}
