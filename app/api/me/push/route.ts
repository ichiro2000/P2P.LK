import type { NextRequest } from "next/server";
import { memberFromRequest } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { rateLimit } from "@/lib/guard";
import { memberError, ok } from "@/lib/member-api";
import { MAX_DEVICES } from "@/lib/push/deliver";
import { vapidPublicKey } from "@/lib/push/server";
import { listDevices } from "@/lib/push/store";

export const dynamic = "force-dynamic";

/** GET /api/me/push → { devices, max, publicKey } — the member's devices with
 *  push on. `publicKey` is null when push isn't configured on the server. */
export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, "read", "me");
  if (limited) return limited;
  const m = await memberFromRequest(req);
  if (!m.ok) return m.res;
  try {
    const [devices, publicKey] = await Promise.all([listDevices(await getDb(), m.viewer.id), vapidPublicKey()]);
    return ok({ devices, max: MAX_DEVICES, publicKey });
  } catch (err) {
    return memberError(err);
  }
}
