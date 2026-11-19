import type { NextRequest } from "next/server";
import { z } from "zod";
import { memberFromRequest } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { jsonError, rateLimit, readJson } from "@/lib/guard";
import { memberError, ok } from "@/lib/member-api";
import { rotate, subscribe } from "@/lib/push/store";
import { SubscriptionJson, zEndpoint } from "@/lib/push/subscription";

export const dynamic = "force-dynamic";

const Body = z.object({ oldEndpoint: zEndpoint.nullish(), subscription: SubscriptionJson });

/**
 * POST /api/push/rotate { oldEndpoint, subscription } — called by the
 * service worker on `pushsubscriptionchange` (the browser replaced the
 * subscription). Moves the old row to the new endpoint, keeping its owner;
 * works without a session (the old endpoint is the proof). With no known
 * old endpoint, falls back to the signed-in member. 404 when neither.
 */
export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, "write", "push-rotate");
  if (limited) return limited;
  const body = await readJson(req, Body);
  if (!body.ok) return body.res;
  try {
    const db = await getDb();
    const ua = req.headers.get("user-agent");
    const { oldEndpoint, subscription } = body.data;
    if (oldEndpoint && (await rotate(db, oldEndpoint, subscription, ua))) return ok({ status: "rotated" });
    const m = await memberFromRequest(req);
    if (!m.ok) return jsonError(404, "Unknown subscription.");
    const r = await subscribe(db, m.viewer.id, subscription, ua, "sync");
    if (r.status === "limit") return jsonError(409, "Device limit reached.", { limit: true });
    return ok({ status: r.status });
  } catch (err) {
    return memberError(err);
  }
}
