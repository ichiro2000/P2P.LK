import { NextResponse, type NextRequest } from "next/server";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, getEnv, schema } from "@/lib/db/client";
import { adminFromRequest } from "@/lib/auth/session";
import { baseUrlOf } from "@/lib/auth/config";
import { jsonError, rateLimit, readJson } from "@/lib/guard";
import { audit } from "@/lib/member-data";
import { sendEmail } from "@/lib/email/send";
import * as tpl from "@/lib/email/templates";

/**
 * PATCH /api/admin/members/:id — one admin decision on one member.
 *
 * Every UPDATE carries the expected current status/role in its WHERE clause,
 * so a double click or two admins racing on the same member change it once;
 * the loser gets 409. Each successful action is written to audit_log, and
 * approve/reject send the member an email (a mail failure doesn't undo the
 * decision — the response says `emailed: false`).
 */

const NOTE_MAX = 1000;
const note = z.string().trim().max(NOTE_MAX, `must be at most ${NOTE_MAX} characters`);

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), note: note.optional() }),
  z.object({ action: z.literal("reject"), note: note.min(1, "A note is required to reject.") }),
  z.object({ action: z.literal("suspend"), note: note.min(1, "A note is required to suspend.") }),
  z.object({ action: z.literal("unsuspend"), note: note.optional() }),
  z.object({ action: z.literal("make_admin") }),
  z.object({ action: z.literal("remove_admin") }),
]);

const Id = z.string().min(1).max(100);

const NO_STORE = { "Cache-Control": "no-store" };

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const limited = await rateLimit(req, "admin", "members");
  if (limited) return limited;
  const admin = await adminFromRequest(req);
  if (!admin) {
    // Signed in but not an admin → 403; no session → 401.
    const hasSession = /(?:^|;\s*)(?:__Secure-)?p2plk\.session_token=/.test(req.headers.get("cookie") ?? "");
    return jsonError(hasSession ? 403 : 401, hasSession ? "Admins only." : "Sign in required.");
  }

  const idParsed = Id.safeParse((await ctx.params).id);
  if (!idParsed.success) return jsonError(400, "Invalid member id.");
  const id = idParsed.data;
  const body = await readJson(req, Body);
  if (!body.ok) return body.res;
  const input = body.data;

  const db = await getDb();
  const u = schema.user;
  const target = await db.query.user.findFirst({
    where: eq(u.id, id),
    columns: { id: true, name: true, email: true, status: true, role: true },
  });
  if (!target) return jsonError(404, "Member not found.");

  const now = new Date();
  const reviewed = { reviewedAt: now, reviewedBy: admin.id, updatedAt: now };
  const noteOf = "note" in input ? input.note?.trim() || null : null;
  const self = target.id === admin.id;

  let where;
  let set: Partial<typeof u.$inferInsert>;
  let conflict = "This member was changed by someone else — refresh and try again.";

  switch (input.action) {
    case "approve":
      where = and(eq(u.id, id), inArray(u.status, ["pending_review", "rejected"]));
      set = { status: "approved", reviewNote: noteOf, ...reviewed };
      break;
    case "reject":
      where = and(eq(u.id, id), eq(u.status, "pending_review"));
      set = { status: "rejected", reviewNote: noteOf, ...reviewed };
      break;
    case "suspend":
      if (self) return jsonError(400, "You can't suspend yourself.");
      if (target.role === "admin") return jsonError(400, "Remove admin rights before suspending this member.");
      where = and(eq(u.id, id), eq(u.status, "approved"), eq(u.role, "user"));
      set = { status: "suspended", reviewNote: noteOf, ...reviewed };
      break;
    case "unsuspend":
      where = and(eq(u.id, id), eq(u.status, "suspended"));
      set = { status: "approved", reviewNote: noteOf, ...reviewed };
      break;
    case "make_admin":
      where = and(eq(u.id, id), eq(u.role, "user"), eq(u.status, "approved"));
      set = { role: "admin", updatedAt: now };
      conflict = "Only approved members who aren't admins yet can be made admin.";
      break;
    case "remove_admin":
      if (self) return jsonError(400, "You can't remove your own admin rights.");
      // The count guard runs inside the same UPDATE, so two admins removing
      // each other at once can't leave zero admins.
      where = and(
        eq(u.id, id),
        eq(u.role, "admin"),
        ne(u.id, admin.id),
        sql`(SELECT count(*) FROM ${u} WHERE ${u.role} = 'admin' AND ${u.status} = 'approved') > 1`,
      );
      set = { role: "user", updatedAt: now };
      conflict = "Can't remove the last admin.";
      break;
  }

  const updated = await db.update(u).set(set).where(where).returning({ id: u.id, status: u.status, role: u.role });
  if (updated.length === 0) return jsonError(409, conflict, { status: target.status, role: target.role });
  const after = updated[0];

  // Suspension signs the member out everywhere, right now.
  let sessionsRevoked = 0;
  if (input.action === "suspend") {
    const r = await db.delete(schema.session).where(eq(schema.session.userId, id)).returning({ id: schema.session.id });
    sessionsRevoked = r.length;
  }

  await audit({
    actorId: admin.id,
    actorEmail: admin.email,
    action: `member.${input.action}`,
    targetType: "user",
    targetId: id,
    detail: {
      email: target.email,
      from: { status: target.status, role: target.role },
      to: { status: after.status, role: after.role },
      ...(noteOf ? { note: noteOf } : {}),
      ...(input.action === "suspend" ? { sessionsRevoked } : {}),
    },
  }).catch((err) => console.error("[admin] audit write failed", err));

  let emailed: boolean | null = null;
  if (input.action === "approve" || input.action === "reject") {
    try {
      const env = await getEnv();
      const mail =
        input.action === "approve"
          ? tpl.approved(target.email, target.name, `${baseUrlOf(env)}/app`)
          : tpl.rejected(target.email, target.name, noteOf);
      await sendEmail(mail, env);
      emailed = true;
    } catch (err) {
      console.error(`[admin] ${input.action} email failed`, err);
      emailed = false;
    }
  }

  return NextResponse.json({ ok: true, member: after, emailed, sessionsRevoked }, { headers: NO_STORE });
}
