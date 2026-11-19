/**
 * History ranges reserved for approved members (PLAN §9: "full history").
 * Shared by the server gates (pages + APIs) and the range chips in the UI.
 */
export const MEMBER_RANGES = ["7d", "30d"] as const;
export type MemberRange = (typeof MEMBER_RANGES)[number];

export function isMemberRange(r: unknown): r is MemberRange {
  return typeof r === "string" && (MEMBER_RANGES as readonly string[]).includes(r);
}

/** Where a locked chip sends a guest. */
export const MEMBER_SIGN_UP_HREF = "/sign-up";
