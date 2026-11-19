import type { NextRequest } from "next/server";
import { memberFromRequest } from "@/lib/auth/session";
import { jsonError, rateLimit, readJson } from "@/lib/guard";
import { deleteRule, listRules, updateRule } from "@/lib/member-data";
import { RulePatch, memberError, ok, thresholdOk } from "@/lib/member-api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const ID = /^[0-9a-f-]{36}$/i;

/** PATCH /api/me/rules/:id { enabled?, email?, cooldownSec?, threshold?, label?, exchange? } → { rule } */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const limited = await rateLimit(req, "read", "me-write");
  if (limited) return limited;
  const m = await memberFromRequest(req);
  if (!m.ok) return m.res;
  const { id } = await params;
  if (!ID.test(id)) return jsonError(404, "Rule not found.");
  const body = await readJson(req, RulePatch);
  if (!body.ok) return body.res;
  try {
    const current = (await listRules(m.viewer.id)).find((r) => r.id === id);
    if (!current) return jsonError(404, "Rule not found.");
    if (body.data.threshold != null && !thresholdOk(current.type, body.data.threshold)) {
      return jsonError(400, "threshold: is too large for this rule type");
    }
    const patch = Object.fromEntries(Object.entries(body.data).filter(([, v]) => v !== undefined));
    await updateRule(m.viewer.id, id, patch);
    return ok({ rule: { ...current, ...patch } });
  } catch (err) {
    return memberError(err);
  }
}

/** DELETE /api/me/rules/:id */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const limited = await rateLimit(req, "read", "me-write");
  if (limited) return limited;
  const m = await memberFromRequest(req);
  if (!m.ok) return m.res;
  const { id } = await params;
  if (!ID.test(id)) return jsonError(404, "Rule not found.");
  try {
    await deleteRule(m.viewer.id, id);
    return ok({ ok: true });
  } catch (err) {
    return memberError(err);
  }
}
