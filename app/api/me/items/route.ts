import type { NextRequest } from "next/server";
import { z } from "zod";
import { memberFromRequest } from "@/lib/auth/session";
import { rateLimit, readJson, readQuery } from "@/lib/guard";
import { deleteItem, listItems, upsertItem } from "@/lib/member-data";
import { ItemBody, cleanData, itemKeyFor, memberError, ok, zKind } from "@/lib/member-api";

export const dynamic = "force-dynamic";

/** GET /api/me/items?kind=market → { items } */
export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, "read", "me");
  if (limited) return limited;
  const m = await memberFromRequest(req);
  if (!m.ok) return m.res;
  const q = readQuery(req, z.object({ kind: zKind.optional() }));
  if (!q.ok) return q.res;
  try {
    return ok({ items: await listItems(m.viewer.id, q.data.kind) });
  } catch (err) {
    return memberError(err);
  }
}

/** POST /api/me/items { kind, data, itemKey? } → { item }  (upsert) */
export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, "read", "me-write");
  if (limited) return limited;
  const m = await memberFromRequest(req);
  if (!m.ok) return m.res;
  const body = await readJson(req, ItemBody);
  if (!body.ok) return body.res;
  const itemKey = itemKeyFor(body.data);
  const data = cleanData(body.data.data);
  try {
    await upsertItem(m.viewer.id, body.data.kind, itemKey, data);
    return ok({ item: { kind: body.data.kind, itemKey, data, createdAt: Math.floor(Date.now() / 1000) } });
  } catch (err) {
    return memberError(err);
  }
}

const DeleteQuery = z.object({ kind: zKind, key: z.string().trim().min(1).max(100) });

/** DELETE /api/me/items?kind=merchant&key=binance:123 */
export async function DELETE(req: NextRequest) {
  const limited = await rateLimit(req, "read", "me-write");
  if (limited) return limited;
  const m = await memberFromRequest(req);
  if (!m.ok) return m.res;
  const q = readQuery(req, DeleteQuery);
  if (!q.ok) return q.res;
  try {
    await deleteItem(m.viewer.id, q.data.kind, q.data.key);
    return ok({ ok: true });
  } catch (err) {
    return memberError(err);
  }
}
