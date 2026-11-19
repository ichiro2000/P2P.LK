import type { NextRequest } from "next/server";
import { z } from "zod";
import { memberFromRequest } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { jsonError, rateLimit, readJson } from "@/lib/guard";
import { memberError, ok } from "@/lib/member-api";
import { MAX_DEVICES } from "@/lib/push/deliver";
import { vapidPublicKey } from "@/lib/push/server";
import { subscribe } from "@/lib/push/store";
import { SubscriptionJson } from "@/lib/push/subscription";

export const dynamic = "force-dynamic";

const Body = z.object({
  subscription: SubscriptionJson,
  /** "enable" = the member pressed the button; "sync" = background re-sync
   *  on app open/focus (never revives a removed/dead device). */
  mode: z.enum(["enable", "sync"]).default("sync"),
});

/**
 * POST /api/me/push/subscribe { subscription, mode } →
 *   { status: "created" | "known", id, publicKey }   registered / refreshed
 *   { status: "removed" | "gone", publicKey }        sync refused (see store.ts)
 *   409 { limit: true }                              10 devices already
 * Upserts by endpoint and re-binds it to the current member; refreshes
 * last_seen_at every time.
 */
export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, "read", "me-write");
  if (limited) return limited;
  const m = await memberFromRequest(req);
  if (!m.ok) return m.res;
  const body = await readJson(req, Body);
  if (!body.ok) return body.res;
  try {
    const publicKey = await vapidPublicKey();
    if (!publicKey) return jsonError(503, "Push notifications aren't configured on this server.");
    const r = await subscribe(
      await getDb(),
      m.viewer.id,
      body.data.subscription,
      req.headers.get("user-agent"),
      body.data.mode,
    );
    if (r.status === "limit") {
      return jsonError(409, `You can get notifications on up to ${MAX_DEVICES} devices. Remove one first.`, {
        limit: true,
      });
    }
    return ok({ ...r, publicKey }, r.status === "created" ? 201 : 200);
  } catch (err) {
    return memberError(err);
  }
}
