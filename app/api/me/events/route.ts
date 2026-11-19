import type { NextRequest } from "next/server";
import { z } from "zod";
import { memberFromRequest } from "@/lib/auth/session";
import { rateLimit, readJson, readQuery } from "@/lib/guard";
import { clearEvents, listEvents, markEventsRead, unreadCount } from "@/lib/member-data";
import { memberError, ok } from "@/lib/member-api";

export const dynamic = "force-dynamic";

const Query = z.object({
  unread: z.enum(["0", "1"]).catch("0").default("0"),
  limit: z.coerce.number().int().min(1).max(500).catch(100).default(100),
});

/** GET /api/me/events[?unread=1][&limit=100] → { events, unread } */
export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, "read", "me");
  if (limited) return limited;
  const m = await memberFromRequest(req);
  if (!m.ok) return m.res;
  const q = readQuery(req, Query);
  if (!q.ok) return q.res;
  try {
    const [events, unread] = await Promise.all([
      listEvents(m.viewer.id, q.data.limit),
      unreadCount(m.viewer.id),
    ]);
    return ok({ events: q.data.unread === "1" ? events.filter((e) => !e.read) : events, unread });
  } catch (err) {
    return memberError(err);
  }
}

const MarkRead = z.object({
  /** Omit to mark every event read. */
  ids: z.array(z.string().trim().min(1).max(64)).max(500).optional(),
});

/** POST /api/me/events { ids? } → marks read */
export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, "read", "me-write");
  if (limited) return limited;
  const m = await memberFromRequest(req);
  if (!m.ok) return m.res;
  const body = await readJson(req, MarkRead);
  if (!body.ok) return body.res;
  try {
    await markEventsRead(m.viewer.id, body.data.ids);
    return ok({ ok: true, unread: await unreadCount(m.viewer.id) });
  } catch (err) {
    return memberError(err);
  }
}

/** DELETE /api/me/events → clears the inbox */
export async function DELETE(req: NextRequest) {
  const limited = await rateLimit(req, "read", "me-write");
  if (limited) return limited;
  const m = await memberFromRequest(req);
  if (!m.ok) return m.res;
  try {
    await clearEvents(m.viewer.id);
    return ok({ ok: true });
  } catch (err) {
    return memberError(err);
  }
}
