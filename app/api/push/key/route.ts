import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@/lib/guard";
import { vapidPublicKey } from "@/lib/push/server";

export const dynamic = "force-dynamic";

/** GET /api/push/key → { publicKey } (the VAPID application server key).
 *  Public: the service worker reads it in `pushsubscriptionchange`, where
 *  the session may have expired. 503 when push isn't configured. */
export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, "read", "push-key");
  if (limited) return limited;
  const publicKey = await vapidPublicKey();
  if (!publicKey) {
    return NextResponse.json(
      { error: "Push notifications aren't configured on this server." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json({ publicKey }, { headers: { "Cache-Control": "no-store" } });
}
