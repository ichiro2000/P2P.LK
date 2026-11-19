import type { NextRequest } from "next/server";
import { getAuth } from "@/lib/auth/config";

/** Better Auth's endpoints (/api/auth/*). The instance is built per env. */
async function handle(req: NextRequest) {
  const auth = await getAuth();
  return auth.handler(req);
}

export { handle as GET, handle as POST };
