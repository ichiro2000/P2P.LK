import { NextRequest, NextResponse } from "next/server";
import { addReport, listSuspicious } from "@/lib/db/suspicious";
import { z } from "zod";
import { rateLimit, readJson, zRequiredText, zText } from "@/lib/guard";
import { audit } from "@/lib/member-data";
import { isAdmin, memberFromRequest } from "@/lib/auth/session";
import {
  fetchBinanceAdvertiserPublic,
  resolveBinanceProfile,
} from "@/lib/qr-resolve";

const PostBody = z.object({
  /** Either the full decoded QR string or a pre-parsed advertiserNo. */
  decoded: zRequiredText(2048, "`decoded` is required (decoded QR content or advertiserNo)."),
  reason: zRequiredText(120, "`reason` is required (e.g. \"4th Party Scam\")."),
  displayName: zText(120),
  notes: zText(1000),
  reporter: zText(120),
});

export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, "read");
  if (limited) return limited;
  // The full list is members-only; guests check one QR at a time via /check.
  const who = await memberFromRequest(req);
  if (!who.ok) return who.res;
  const rows = await listSuspicious();
  return NextResponse.json({ reports: rows });
}

/** Members submit (→ pending, an admin publishes it); admins publish directly. */
export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, "write", "report");
  if (limited) return limited;
  const who = await memberFromRequest(req);
  if (!who.ok) return who.res;
  const viewer = who.viewer;
  const admin = isAdmin(viewer);
  const body = await readJson(req, PostBody);
  if (!body.ok) return body.res;
  const { decoded, reason } = body.data;

  // Resolve the QR — short-links get followed server-side so we store the
  // real advertiserNo, not an opaque redirect URL. Essential for dedupe: the
  // same merchant can be shared via many short-link codes.
  const ref = await resolveBinanceProfile(decoded);
  if (!ref) {
    return NextResponse.json(
      {
        error:
          "Couldn't find a Binance advertiserNo in the decoded QR. Expected a Binance P2P profile URL.",
      },
      { status: 422 },
    );
  }

  // When the caller didn't pass a displayName, try to fill it in from our
  // local merchant snapshots → Binance. Keeps the registry useful when the
  // poster was in a hurry and just uploaded the QR.
  let displayName = body.data.displayName;
  if (!displayName) {
    const live = await fetchBinanceAdvertiserPublic(ref.userId).catch(
      () => null,
    );
    if (live?.nickName) displayName = live.nickName.slice(0, 120);
  }

  // QR resolution is Binance-only for now; Bybit QR support comes with the
  // Bybit profile endpoint.
  const inserted = await addReport({
    exchange: "binance",
    userId: ref.userId,
    profileUrl: ref.profileUrl,
    displayName,
    reason,
    notes: body.data.notes,
    reporter: body.data.reporter ?? viewer.merchantName,
    status: admin ? "active" : "pending",
    submittedBy: viewer.id,
  });
  await audit({
    actorId: viewer.id,
    actorEmail: viewer.email,
    action: admin ? "registry.publish" : "registry.submit",
    targetType: "suspicious_report",
    targetId: String(inserted.id),
    detail: { userId: inserted.userId, reason: inserted.reason },
  }).catch(() => undefined);

  return NextResponse.json({ report: inserted, pending: !admin }, { status: 201 });
}
