import type { NextRequest } from "next/server";
import { memberFromRequest } from "@/lib/auth/session";
import { rateLimit } from "@/lib/guard";
import { listMyReports } from "@/lib/db/registry-admin";
import { memberError, ok } from "@/lib/member-api";

export const dynamic = "force-dynamic";

/** GET /api/me/reports → { reports } — the member's own registry
 *  submissions in every status (pending, active, rejected, retracted). */
export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, "read", "me");
  if (limited) return limited;
  const m = await memberFromRequest(req);
  if (!m.ok) return m.res;
  try {
    return ok({ reports: await listMyReports(m.viewer.id) });
  } catch (err) {
    return memberError(err);
  }
}
