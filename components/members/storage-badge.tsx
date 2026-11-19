"use client";

import { Badge } from "@/components/ui/badge";
import { useMemberMode } from "@/hooks/use-member-data";

/** "Synced to your account" for members, "Stored in this browser" for guests. */
export function StorageBadge() {
  const { mode } = useMemberMode();
  if (mode === "loading") return null;
  return <Badge variant="outline">{mode === "member" ? "Synced to your account" : "Stored in this browser"}</Badge>;
}
