import "server-only";
import type { NextRequest } from "next/server";
import { getViewer, isMember, memberFromRequest } from "@/lib/auth/session";
import { jsonError } from "@/lib/guard";
import { isMemberRange } from "@/lib/member-ranges";

export { isMemberRange, MEMBER_RANGES } from "@/lib/member-ranges";

/** True when the current page viewer is an approved member (or admin). */
export async function viewerIsMember(): Promise<boolean> {
  return isMember(await getViewer());
}

/**
 * Page gate for long history ranges. Non-members asking for 7d/30d get the
 * fallback range instead (server-side, so the data never reaches them).
 */
export async function gateRange<R extends string>(
  range: R,
  fallback: R,
): Promise<{ range: R; member: boolean; locked: boolean }> {
  const member = await viewerIsMember();
  if (!member && isMemberRange(range)) return { range: fallback, member, locked: true };
  return { range, member, locked: false };
}

/**
 * API gate for long history ranges: null when allowed, else a ready 403.
 * Short ranges stay public and skip the session lookup entirely.
 */
export async function memberRangeGuard(req: NextRequest, range: string) {
  if (!isMemberRange(range)) return null;
  const m = await memberFromRequest(req);
  if (m.ok) return null;
  return jsonError(403, "7-day and 30-day history is for members. Create a free account to unlock it.", {
    members: true,
  });
}

/** Cache header for a response: member-only ranges must never sit in a
 *  shared cache. */
export function rangeCacheControl(range: string, publicValue: string) {
  return isMemberRange(range) ? "private, no-store" : publicValue;
}
