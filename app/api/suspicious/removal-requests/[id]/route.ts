import { NextRequest, NextResponse } from "next/server";
import { decideRemovalRequest, RemovalRequestError } from "@/lib/db/removal-requests";
import { z } from "zod";
import { readJson, requireAdmin, zText } from "@/lib/guard";
import { adminFromRequest } from "@/lib/auth/session";
import { audit } from "@/lib/member-data";

const PatchBody = z.object({
  decision: z.enum(["approved", "rejected"], { error: "`decision` must be 'approved' or 'rejected'." }),
  reviewNote: zText(1000),
});

/**
 * PATCH — admin-only. Applies a decision to a pending removal request. On
 * `approved`, `decideRemovalRequest` also flips all active reports for the
 * same taker to `retracted`, which drops them from every public listing.
 * Each decision is written to audit_log (registry.removal.approve / .reject).
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const admin = await adminFromRequest(req);
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const { id: raw } = await ctx.params;
  const id = /^\d{1,12}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid request id." }, { status: 400 });
  }

  const body = await readJson(req, PatchBody);
  if (!body.ok) return body.res;
  const { decision, reviewNote } = body.data;

  try {
    const result = await decideRemovalRequest({
      id,
      decision,
      reviewNote,
      reviewedBy: admin.id,
    });
    await audit({
      actorId: admin.id,
      actorEmail: admin.email,
      action: decision === "approved" ? "registry.removal.approve" : "registry.removal.reject",
      targetType: "removal_request",
      targetId: String(id),
      detail: {
        userId: result.request.userId,
        exchange: result.request.exchange,
        retractedCount: result.retractedCount,
        ...(reviewNote ? { note: reviewNote } : {}),
      },
    }).catch((err) => console.error("[admin] audit write failed", err));
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof RemovalRequestError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "Decision failed." }, { status: 500 });
  }
}
