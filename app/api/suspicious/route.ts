import { NextRequest, NextResponse } from "next/server";
import { addReport, listSuspicious } from "@/lib/db/suspicious";
import { checkAdminToken } from "@/lib/admin-auth";
import {
  fetchBybitAdvertiserPublic,
  resolveBinanceProfile,
} from "@/lib/qr-resolve";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PostBody = {
  /** Either the full decoded QR string or a pre-parsed advertiserNo. */
  decoded?: unknown;
  displayName?: unknown;
  reason?: unknown;
  notes?: unknown;
  reporter?: unknown;
};

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

export async function GET() {
  const rows = await listSuspicious();
  return NextResponse.json({ reports: rows });
}

export async function POST(req: NextRequest) {
  const auth = checkAdminToken(req.headers.get("x-admin-token"));
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 401 });
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const decoded = str(body.decoded, 2048);
  const reason = str(body.reason, 120);
  if (!decoded) {
    return NextResponse.json(
      { error: "`decoded` is required (decoded QR content or advertiserNo)." },
      { status: 400 },
    );
  }
  if (!reason) {
    return NextResponse.json(
      { error: "`reason` is required (e.g. \"4th Party Scam\")." },
      { status: 400 },
    );
  }

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
  let displayName = str(body.displayName, 120);
  if (!displayName) {
    const live = await fetchBybitAdvertiserPublic(ref.userId).catch(
      () => null,
    );
    if (live?.nickName) displayName = live.nickName.slice(0, 120);
  }

  const inserted = await addReport({
    binanceUserId: ref.userId,
    profileUrl: ref.profileUrl,
    displayName,
    reason,
    notes: str(body.notes, 1000),
    reporter: str(body.reporter, 120),
  });

  return NextResponse.json({ report: inserted }, { status: 201 });
}
