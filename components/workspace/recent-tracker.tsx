"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { recent } from "@/lib/storage";

const TITLES: Record<string, string> = {
  "/": "Live markets",
  "/arbitrage": "Arbitrage",
  "/historical": "Historical",
  "/merchants": "Merchants",
  "/liquidity": "Liquidity",
  "/risk": "Risk",
  "/alerts": "Alerts",
  "/workspace": "Workspace",
  "/reports": "Reports",
};

/**
 * Client-only side-effect: writes a "recent visit" entry whenever the
 * path+search changes. Skips the /workspace route itself (uninteresting).
 */
export function RecentTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname || pathname === "/workspace") return;
    const search = searchParams?.toString() ?? "";
    const title = TITLES[pathname] ?? pathname;
    const label = search ? `${title} · ${decodeURIComponent(search)}` : title;
    recent.track({ path: pathname, search, title: label });
  }, [pathname, searchParams]);

  return null;
}
