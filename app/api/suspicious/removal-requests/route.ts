import { NextRequest, NextResponse } from "next/server";
import {
  createRemovalRequest,
  hasPendingRemovalRequest,
  listRemovalRequests,
  type RemovalStatus,
} from "@/lib/db/removal-requests";
import { reportsForUser } from "@/lib/db/suspicious";
import { z } from "zod";
import { DEFAULT_EXCHANGE, EXCHANGE_IDS } from "@/lib/exchanges";
import {
  rateLimit,
  readJson,
  readQuery,
  requireAdmin,
  verifyTurnstile,
  zRequiredText,
  zText,
} from "@/lib/guard";

const PostBody = z
  .object({
    userId: zText(200),
    /** Accepted for older clients. */
    binanceUserId: zText(200),
    exchange: z.enum(EXCHANGE_IDS).default(DEFAULT_EXCHANGE),
    reason: zRequiredText(1000, "`reason` is required — explain why this flag is mistaken."),
    reporterContact: zText(200),
    turnstileToken: zText(4096),
  })
  .refine((b) => b.userId || b.binanceUserId, { message: "`userId` is required.", path: ["userId"] });

const StatusQuery = z.object({
  status: z.enum(["pending", "approved", "rejected", "all"]).catch("pending").default("pending"),
});

/**
 * GET — admin-only. Returns pending removal requests by default; pass
 * `?status=approved|rejected|all` to switch. Used by the `/admin/removals`
 * queue page.
 */
export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const q = readQuery(req, StatusQuery);
  if (!q.ok) return q.res;
  const status: RemovalStatus | "all" = q.data.status;
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
  const limited = await rateLimit(req, "write", "removal");
  if (limited) return limited;
  const body = await readJson(req, PostBody);
  if (!body.ok) return body.res;
  const bot = await verifyTurnstile(req, body.data.turnstileToken);
  if (bot) return bot;
  const { exchange, reason, reporterContact } = body.data;
  const userId = (body.data.userId ?? body.data.binanceUserId)!;

  const activeReports = await reportsForUser(exchange, userId);
  if (activeReports.length === 0) {
    return NextResponse.json(
      {
        error:
          "This taker isn't on the active suspicious list — nothing to remove.",
      },
      { status: 422 },
    );
  }

  if (await hasPendingRemovalRequest(exchange, userId)) {
    return NextResponse.json(
      {
        error:
          "A removal request is already pending for this taker. An admin will review it shortly.",
      },
      { status: 409 },
    );
  }

  const inserted = await createRemovalRequest({
    exchange,
    userId,
    reason,
    reporterContact,
  });

  return NextResponse.json({ request: inserted }, { status: 201 });
}
