import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { escapeCell } from "@/lib/csv";
import { formatSLT } from "@/lib/format";
import { AUDIT_EXPORT_CAP, exportAudit, parseAuditQuery } from "@/lib/db/audit";

export const dynamic = "force-dynamic";

/** Spreadsheet apps run cells starting with = + - @ as formulas. */
function cell(v: string | number | null | undefined): string {
  if (typeof v === "string" && /^\s*[=+\-@]|^[\t\r]/.test(v)) v = `'${v}`;
  return escapeCell(v);
}

/**
 * GET /api/admin/audit/export?action=&actor=&targetType=&targetId=&from=&to=
 * → CSV of the current filter, newest first, capped at AUDIT_EXPORT_CAP rows.
 */
export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const q = parseAuditQuery(Object.fromEntries(req.nextUrl.searchParams));
  // Cursors don't apply to an export.
  const rows = await exportAudit({ ...q, before: undefined, after: undefined });

  const header = ["id", "ts_utc", "time_slt", "actor_email", "actor_id", "action", "target_type", "target_id", "detail"];
  const lines = rows.map((r) =>
    [
      r.id,
      new Date(r.ts * 1000).toISOString(),
      formatSLT(r.ts, { dateStyle: "short", timeStyle: "medium" }),
      r.actorEmail,
      r.actorId,
      r.action,
      r.targetType,
      r.targetId,
      r.detail ? JSON.stringify(r.detail) : "",
    ]
      .map(cell)
      .join(","),
  );
  const csv = `﻿${[header.join(","), ...lines].join("\r\n")}\r\n`;
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="p2plk-audit-${stamp}.csv"`,
      "Cache-Control": "no-store",
      "X-Row-Count": String(rows.length),
      "X-Row-Cap": String(AUDIT_EXPORT_CAP),
    },
  });
}
