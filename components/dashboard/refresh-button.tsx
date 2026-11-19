"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Re-runs the server render (no polling). */
export function RefreshButton({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      className={cn("h-10 sm:h-8", className)}
      disabled={pending}
      onClick={() => start(() => router.refresh())}
      aria-label="Refresh dashboard"
    >
      <RefreshCw className={cn(pending && "animate-spin")} aria-hidden />
      <span>{pending ? "Refreshing" : "Refresh"}</span>
    </Button>
  );
}
