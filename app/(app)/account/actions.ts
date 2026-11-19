"use server";

import { headers } from "next/headers";
import { getAuth } from "@/lib/auth/config";
import { getViewer } from "@/lib/auth/session";
import { sessionTokenFor } from "@/lib/account";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Sign one of the viewer's other devices out. Looks the token up by
 *  (session id, user id) so the browser never sees session tokens. */
export async function revokeDeviceSession(sessionId: string): Promise<ActionResult> {
  if (typeof sessionId !== "string" || !sessionId || sessionId.length > 100)
    return { ok: false, error: "Unknown session." };
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: "Your session has ended. Sign in again." };
  const token = await sessionTokenFor(viewer.id, sessionId);
  if (!token) return { ok: false, error: "That session has already ended." };
  try {
    const auth = await getAuth();
    await auth.api.revokeSession({ headers: await headers(), body: { token } });
    return { ok: true };
  } catch (err) {
    console.error("[account] revoke session", err);
    return { ok: false, error: "Couldn't sign that device out. Try again." };
  }
}
