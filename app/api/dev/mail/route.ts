import { NextResponse } from "next/server";
import { readDevOutbox } from "@/lib/email/send";

/** Local development only: the mail the app would have sent (newest first). */
export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ mail: await readDevOutbox() }, { headers: { "Cache-Control": "no-store" } });
}
