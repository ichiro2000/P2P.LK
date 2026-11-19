import type { NextRequest } from "next/server";
import { z } from "zod";
import { memberFromRequest } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { rateLimit, readJson } from "@/lib/guard";
import { memberError, ok } from "@/lib/member-api";
import { unsubscribe } from "@/lib/push/store";

export const dynamic = "force-dynamic";

const Body = z
  .object({
    /** This browser's endpoint (turning push off here, or signing out). */
    endpoint: z.string().trim().max(1024).optional(),
    /** A device from the list ("Remove"). */
    id: z.string().trim().max(64).optional(),
  })
  .refine((b) => !!b.endpoint !== !!b.id, { message: "send exactly one of endpoint or id" });

/** POST /api/me/push/unsubscribe { endpoint } | { id } → { removed } */
export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, "read", "me-write");
  if (limited) return limited;
  const m = await memberFromRequest(req);
  if (!m.ok) return m.res;
  const body = await readJson(req, Body);
  if (!body.ok) return body.res;
  try {
    return ok({ removed: await unsubscribe(await getDb(), m.viewer.id, body.data) });
  } catch (err) {
    return memberError(err);
  }
}
