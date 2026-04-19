import { NextRequest, NextResponse } from "next/server";
import { decideRemovalRequest } from "@/lib/db/removal-requests";
import { checkAdminToken } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PatchBody = {
  decision?: unknown;
  reviewNote?: unknown;
};

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/**
 * PATCH — admin-only. Applies a decision to a pending removal request. On
 * `approved`, `decideRemovalRequest` also flips all active reports for the
 * same taker to `retracted`, which drops them from every public listing.
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = checkAdminToken(req.headers.get("x-admin-token"));
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  const { id: raw } = await ctx.params;
  const id = Number.parseInt(raw, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid request id." }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const decision =
    body.decision === "approved" || body.decision === "rejected"
      ? body.decision
      : null;
  if (!decision) {
    return NextResponse.json(
      { error: "`decision` must be 'approved' or 'rejected'." },
      { status: 400 },
    );
  }

  try {
    const result = await decideRemovalRequest({
      id,
      decision,
      reviewNote: str(body.reviewNote, 1000),
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Decision failed." },
      { status: 409 },
    );
  }
}
