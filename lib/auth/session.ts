import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { and, eq, gt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import type { UserRole, UserStatus } from "@/lib/db/schema";
import { getAuth } from "./config";

/**
 * Who is looking at this page/route?
 *
 *   guest    → no session
 *   viewer   → signed in, any status
 *   member   → status "approved"   (dashboard, alerts, reports, exports,
 *                                   full history)
 *   admin    → role "admin" (always approved)
 */
export type Viewer = {
  id: string;
  name: string;
  email: string;
  merchantName: string;
  whatsapp: string;
  binanceUrl: string | null;
  bybitUrl: string | null;
  role: UserRole;
  status: UserStatus;
  reviewNote: string | null;
  emailVerified: boolean;
  createdAt: Date;
};

function toViewer(u: Record<string, unknown>): Viewer {
  return {
    id: String(u.id),
    name: String(u.name ?? ""),
    email: String(u.email ?? ""),
    merchantName: String(u.merchantName ?? ""),
    whatsapp: String(u.whatsapp ?? ""),
    binanceUrl: (u.binanceUrl as string | null) ?? null,
    bybitUrl: (u.bybitUrl as string | null) ?? null,
    role: (u.role as UserRole) ?? "user",
    status: (u.status as UserStatus) ?? "pending_email",
    reviewNote: (u.reviewNote as string | null) ?? null,
    emailVerified: Boolean(u.emailVerified),
    createdAt: new Date(u.createdAt as string | number | Date),
  };
}

/** The session cookie caches the user (and the session) for a minute;
 *  status and role must be live (approval, suspension, the verify step), and
 *  a revoked session (password change, "sign out other devices", suspension)
 *  must stop working at once — so re-read both in one indexed query. */
async function withLiveStatus(v: Viewer, sessionToken: string): Promise<Viewer | null> {
  const db = await getDb();
  const u = schema.user;
  const s = schema.session;
  const [row] = await db
    .select({ status: u.status, role: u.role, reviewNote: u.reviewNote, emailVerified: u.emailVerified })
    .from(s)
    .innerJoin(u, eq(u.id, s.userId))
    .where(and(eq(s.token, sessionToken), eq(u.id, v.id), gt(s.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;
  return { ...v, ...row };
}

const NO_STORE = { "Cache-Control": "private, no-store" };

/** Current viewer for server components (deduped per request). */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  try {
    const auth = await getAuth();
    const s = await auth.api.getSession({ headers: await headers() });
    return s ? await withLiveStatus(toViewer(s.user as unknown as Record<string, unknown>), s.session.token) : null;
  } catch (err) {
    console.error("[auth] getSession failed", err);
    return null;
  }
});

/** Type guards. Careful: after `if (!isMember(v)) …return`, TypeScript treats
 *  a pending Viewer as impossible — compare `v.status` directly in that case. */
export const isMember = (v: Viewer | null): v is Viewer =>
  !!v && (v.status === "approved" || v.role === "admin");
export const isAdmin = (v: Viewer | null): v is Viewer => !!v && v.role === "admin" && v.status === "approved";

/** Where a signed-in but not-yet-approved viewer should go. */
export function statusPath(v: Viewer): string {
  if (v.status === "pending_email") return `/verify?email=${encodeURIComponent(v.email)}`;
  return "/account/status";
}

/** Page guard: approved members only. */
export async function requireMember(next: string): Promise<Viewer> {
  const v = await getViewer();
  if (!v) redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  if (!isMember(v)) redirect(statusPath(v));
  return v;
}

/** Page guard: signed in (any status). */
export async function requireViewer(next: string): Promise<Viewer> {
  const v = await getViewer();
  if (!v) redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  return v;
}

/** Page guard: admins only. Non-admins get a 404 (don't reveal the page). */
export async function requireAdminPage(next = "/admin"): Promise<Viewer> {
  const v = await getViewer();
  if (!v) redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  if (!isAdmin(v)) notFound();
  return v as Viewer;
}

/** Route-handler guard: returns the member or a ready 401/403 response. */
export async function memberFromRequest(
  req: NextRequest,
): Promise<{ ok: true; viewer: Viewer } | { ok: false; res: NextResponse }> {
  const auth = await getAuth();
  const s = await auth.api.getSession({ headers: req.headers }).catch(() => null);
  if (!s) return { ok: false, res: NextResponse.json({ error: "Sign in required." }, { status: 401, headers: NO_STORE }) };
  const v = await withLiveStatus(toViewer(s.user as unknown as Record<string, unknown>), s.session.token);
  if (!v) return { ok: false, res: NextResponse.json({ error: "Sign in required." }, { status: 401, headers: NO_STORE }) };
  if (!isMember(v))
    return {
      ok: false,
      res: NextResponse.json({ error: "Your account isn't approved yet." }, { status: 403, headers: NO_STORE }),
    };
  return { ok: true, viewer: v };
}

export async function adminFromRequest(req: NextRequest): Promise<Viewer | null> {
  const auth = await getAuth();
  const s = await auth.api.getSession({ headers: req.headers }).catch(() => null);
  if (!s) return null;
  const v = await withLiveStatus(toViewer(s.user as unknown as Record<string, unknown>), s.session.token);
  return v && isAdmin(v) ? v : null;
}
