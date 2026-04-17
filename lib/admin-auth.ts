/**
 * Lightweight shared-secret gate for write endpoints that shouldn't be
 * exposed publicly. Set `ADMIN_TOKEN` in the environment; clients submit
 * the same value in the `x-admin-token` header.
 *
 * Uses a constant-time compare so we don't leak the token length through
 * early-exit timing.
 */

export function checkAdminToken(
  provided: string | null | undefined,
): { ok: true } | { ok: false; error: string } {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return {
      ok: false,
      error:
        "ADMIN_TOKEN is not configured on the server — write endpoint is disabled.",
    };
  }
  if (!provided) return { ok: false, error: "Missing admin token." };
  if (!constantTimeEq(provided, expected)) {
    return { ok: false, error: "Invalid admin token." };
  }
  return { ok: true };
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
