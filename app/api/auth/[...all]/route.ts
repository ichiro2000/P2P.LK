import type { NextRequest } from "next/server";
import { getAuth } from "@/lib/auth/config";
import { rateLimit } from "@/lib/guard";

/** Paths that send email, check a password or a code: tight per-IP limit. */
const SENSITIVE = /\/(sign-in|sign-up|email-otp|forget-password|reset-password|verify-email|change-password)(\/|$)/;

/**
 * Better Auth's endpoints (/api/auth/*). Every request first passes the
 * Cloudflare rate-limit bindings (free, no storage writes): RL_WRITE for the
 * sensitive paths, RL_READ for the rest (session checks, sign-out…).
 */
async function handle(req: NextRequest) {
  // Local dev (and the e2e suite, all from one address) relies on Better
  // Auth's own limiter; the bindings guard the deployed site.
  if (process.env.NODE_ENV !== "development") {
    const path = new URL(req.url).pathname;
    const sensitive = SENSITIVE.test(path);
    const limited = await rateLimit(req, sensitive ? "write" : "read", sensitive ? `auth:${path}` : "auth");
    if (limited) return limited;
  }
  const auth = await getAuth();
  return auth.handler(req);
}

export { handle as GET, handle as POST };
