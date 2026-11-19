import type { NextRequest } from "next/server";
import { memberFromRequest } from "@/lib/auth/session";
import { rateLimit, readJson } from "@/lib/guard";
import { createRule, listRules } from "@/lib/member-data";
import { RuleCreate, memberError, ok } from "@/lib/member-api";
import { ASSET, FIAT } from "@/lib/constants";

export const dynamic = "force-dynamic";

/** GET /api/me/rules → { rules } */
export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, "read", "me");
  if (limited) return limited;
  const m = await memberFromRequest(req);
  if (!m.ok) return m.res;
  try {
    return ok({ rules: await listRules(m.viewer.id) });
  } catch (err) {
    return memberError(err);
  }
}

/** POST /api/me/rules { exchange, type, threshold, label?, enabled?, email?, cooldownSec? } → { rule } */
export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, "read", "me-write");
  if (limited) return limited;
  const m = await memberFromRequest(req);
  if (!m.ok) return m.res;
  const body = await readJson(req, RuleCreate);
  if (!body.ok) return body.res;
  try {
    // Product scope is USDT/LKR only.
    const rule = await createRule(m.viewer.id, { ...body.data, asset: ASSET, fiat: FIAT.code });
    return ok({ rule }, 201);
  } catch (err) {
    return memberError(err);
  }
}
