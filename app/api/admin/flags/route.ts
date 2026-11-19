import { NextResponse, type NextRequest } from "next/server";
import { adminFromRequest } from "@/lib/auth/session";
import { jsonError, readJson, requireAdmin } from "@/lib/guard";
import { audit } from "@/lib/member-data";
import { FlagsSchema, getFlags, setFlags, type Flags } from "@/lib/flags";

/**
 * GET   /api/admin/flags  → current feature flags
 * PATCH /api/admin/flags  → change some of them (partial body), audited as
 *                           `system.flags` with the before/after of each
 *                           changed flag.
 */

const NO_STORE = { "Cache-Control": "no-store" };

const Body = FlagsSchema.partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, "Nothing to change.");

export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  return NextResponse.json({ flags: await getFlags(null, { fresh: true }) }, { headers: NO_STORE });
}

export async function PATCH(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const admin = await adminFromRequest(req);
  if (!admin) return jsonError(403, "Admins only — sign in with an admin account.");

  const body = await readJson(req, Body);
  if (!body.ok) return body.res;

  const { before, after } = await setFlags(body.data);
  const changed = (Object.keys(body.data) as (keyof Flags)[]).filter((k) => before[k] !== after[k]);
  if (changed.length > 0) {
    await audit({
      actorId: admin.id,
      actorEmail: admin.email,
      action: "system.flags",
      targetType: "flags",
      targetId: "flags:v1",
      detail: Object.fromEntries(changed.map((k) => [k, { from: before[k], to: after[k] }])),
    });
  }
  return NextResponse.json({ flags: after, changed }, { headers: NO_STORE });
}
