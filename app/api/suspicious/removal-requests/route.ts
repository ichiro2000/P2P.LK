import { NextRequest, NextResponse } from "next/server";
import {
  createRemovalRequest,
  hasPendingRemovalRequest,
  listRemovalRequests,
  type RemovalStatus,
} from "@/lib/db/removal-requests";
import { reportsForUser } from "@/lib/db/suspicious";
import { checkAdminToken } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PostBody = {
  binanceUserId?: unknown;
  reason?: unknown;
  reporterContact?: unknown;
};

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/**
 * GET — admin-only. Returns pending removal requests by default; pass
 * `?status=approved|rejected|all` to switch. Used by the `/admin/removals`
 * queue page.
 */
export async function GET(req: NextRequest) {
  const auth = checkAdminToken(req.headers.get("x-admin-token"));
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }
  const statusParam = req.nextUrl.searchParams.get("status");
  const status: RemovalStatus | "all" =
    statusParam === "approved" ||
    statusParam === "rejected" ||
    statusParam === "all"
      ? statusParam
      : "pending";
  const rows = await listRemovalRequests({ status });
  return NextResponse.json({ requests: rows });
}

/**
 * POST — public. Anyone can file a request to un-flag a taker; the admin
 * review step is the gate. We reject when the taker isn't currently flagged
 * (nothing to remove) and when there's already a pending request for them
 * (avoid duplicate queue entries).
 */
export async function POST(req: NextRequest) {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const binanceUserId = str(body.binanceUserId, 200);
  const reason = str(body.reason, 1000);
  const reporterContact = str(body.reporterContact, 200);

  if (!binanceUserId) {
    return NextResponse.json(
      { error: "`binanceUserId` is required." },
      { status: 400 },
    );
  }
  if (!reason) {
    return NextResponse.json(
      { error: "`reason` is required — explain why this flag is mistaken." },
      { status: 400 },
    );
  }

  const activeReports = await reportsForUser(binanceUserId);
  if (activeReports.length === 0) {
    return NextResponse.json(
      {
        error:
          "This taker isn't on the active suspicious list — nothing to remove.",
      },
      { status: 422 },
    );
  }

  if (await hasPendingRemovalRequest(binanceUserId)) {
    return NextResponse.json(
      {
        error:
          "A removal request is already pending for this taker. An admin will review it shortly.",
      },
      { status: 409 },
    );
  }

  const inserted = await createRemovalRequest({
    binanceUserId,
    reason,
    reporterContact,
  });

  return NextResponse.json({ request: inserted }, { status: 201 });
}
