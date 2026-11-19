import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { adminFromRequest } from "@/lib/auth/session";
import { jsonError, readJson, requireAdmin } from "@/lib/guard";
import { audit } from "@/lib/member-data";
import { moderateReport } from "@/lib/db/registry-admin";

/**
 * PATCH /api/admin/registry/:id — one moderation decision on one report.
 *
 *   publish  pending            → active     (note optional)
 *   reject   pending            → rejected   (note required)
 *   retract  active             → retracted  (note required)
 *   restore  retracted|rejected → active     (note optional)
 *
 * The expected status is in the UPDATE's WHERE clause; a race returns 409.
 */

const NOTE_MAX = 1000;
const note = z.string().trim().max(NOTE_MAX, `must be at most ${NOTE_MAX} characters`);
const requiredNote = (msg: string) =>
  z.string({ error: msg }).trim().min(1, msg).max(NOTE_MAX, `must be at most ${NOTE_MAX} characters`);

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("publish"), note: note.nullish() }),
  z.object({ action: z.literal("reject"), note: requiredNote("A note is required to reject.") }),
  z.object({ action: z.literal("retract"), note: requiredNote("A note is required to retract.") }),
  z.object({ action: z.literal("restore"), note: note.nullish() }),
]);

const NO_STORE = { "Cache-Control": "no-store" };

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const admin = await adminFromRequest(req);
  if (!admin) return jsonError(403, "Admins only — sign in with an admin account.");

  const raw = (await ctx.params).id;
  const id = /^\d{1,12}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) return jsonError(400, "Invalid report id.");

  const body = await readJson(req, Body);
  if (!body.ok) return body.res;
  const { action } = body.data;
  const noteText = body.data.note?.trim() || null;

  const result = await moderateReport({ id, action, note: noteText, adminId: admin.id });
  if (!result.ok) {
    if (result.code === 404) return jsonError(404, "Report not found.");
    return jsonError(409, `This report is already ${result.status} — refresh and try again.`, { status: result.status });
  }

  await audit({
    actorId: admin.id,
    actorEmail: admin.email,
    action: `registry.${action}`,
    targetType: "suspicious_report",
    targetId: String(id),
    detail: {
      userId: result.report.userId,
      exchange: result.report.exchange,
      reason: result.report.reason,
      from: result.before,
      to: result.report.status,
      ...(noteText ? { note: noteText } : {}),
    },
  }).catch((err) => console.error("[admin] audit write failed", err));

  return NextResponse.json({ ok: true, report: result.report }, { headers: NO_STORE });
}
