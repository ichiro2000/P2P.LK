import type { NextRequest } from "next/server";
import { z } from "zod";
import { memberFromRequest } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { jsonError, rateLimit, readJson } from "@/lib/guard";
import { memberError, ok } from "@/lib/member-api";
import { sendTestPush } from "@/lib/push/deliver";
import { pushEnv } from "@/lib/push/server";

export const dynamic = "force-dynamic";

const Body = z.object({ id: z.string().trim().max(64).optional() });

/**
 * POST /api/me/push/test { id? } → { results: [{ id, ok, status, action }] }
 * Sends a test notification to one device (id) or all of the member's
 * devices, through the same path alerts use. RL_WRITE: 10/min per member and IP.
 */
export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, "read", "me-write");
  if (limited) return limited;
  const m = await memberFromRequest(req);
  if (!m.ok) return m.res;
  // Tight, per member: test pushes go out under our VAPID key, and a push
  // service that sees a flood may throttle that key for everyone.
  const tight = await rateLimit(req, "write", `push-test:${m.viewer.id}`);
  if (tight) return tight;
  const body = await readJson(req, Body);
  if (!body.ok) return body.res;
  try {
    const outcomes = await sendTestPush(await pushEnv(), await getDb(), m.viewer.id, body.data.id);
    if (outcomes.length === 0) return jsonError(404, "No device with notifications on. Enable them first.");
    return ok({
      results: outcomes.map((o) => ({ id: o.id, ok: o.action === "ok", status: o.status, action: o.action })),
    });
  } catch (err) {
    return memberError(err);
  }
}
