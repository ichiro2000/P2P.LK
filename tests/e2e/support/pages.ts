/** Route inventory for the smoke and accessibility sweeps. */

/** Public pages. `/merchants/[id]` is resolved at run time from the live list. */
export const PUBLIC_PAGES = [
  "/",
  "/merchants",
  "/merchants/[id]",
  "/historical",
  "/compare",
  "/arbitrage",
  "/rates",
  "/liquidity",
  "/risk",
  "/suspicious",
] as const;

/** Signed-out auth pages. */
export const AUTH_PAGES = ["/sign-up", "/sign-in", "/verify?email=nobody%40e2e.test", "/forgot-password"] as const;

/** Approved members. */
export const MEMBER_PAGES = ["/app", "/account", "/alerts", "/reports", "/workspace"] as const;

/** Admins. */
export const ADMIN_PAGES = [
  "/admin",
  "/admin/members",
  "/admin/registry",
  "/admin/removals",
  "/admin/audit",
  "/admin/system",
] as const;

/** A merchant that is live on the active exchange right now. */
export async function liveMerchantId(request: import("@playwright/test").APIRequestContext, exchange = "binance") {
  const res = await request.get(`/api/merchants?exchange=${exchange}`);
  const json = (await res.json()) as { merchants?: { id: string; adCount?: number }[] };
  const m = json.merchants?.find((x) => (x.adCount ?? 0) > 0) ?? json.merchants?.[0];
  if (!m) throw new Error(`no ${exchange} merchants available`);
  return m.id;
}

export async function resolvePath(request: import("@playwright/test").APIRequestContext, p: string) {
  return p === "/merchants/[id]" ? `/merchants/${encodeURIComponent(await liveMerchantId(request))}` : p;
}
