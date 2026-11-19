"use client";

import Link from "next/link";
import { Ban, Lock } from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useBlocklist } from "@/hooks/use-member-data";
import type { ExchangeId } from "@/lib/exchanges/types";
import { cn } from "@/lib/utils";

/**
 * Members: block / unblock this merchant (their ads disappear from the
 * Markets table and the arbitrage/compare books). Guests: a locked button
 * pointing to sign-up.
 */
export function BlockMerchantButton({
  exchange,
  id,
  name,
  asset,
  fiat,
  className,
}: {
  exchange: ExchangeId;
  id: string;
  name: string;
  asset?: string;
  fiat?: string;
  className?: string;
}) {
  const blocklist = useBlocklist();
  const base =
    "inline-flex size-10 items-center justify-center gap-1.5 rounded-lg border border-border text-sm transition-colors md:h-8 md:w-auto md:px-3";

  if (blocklist.mode === "loading") {
    return <span className={cn(base, "opacity-0", className)} aria-hidden />;
  }

  if (!blocklist.enabled) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={<Link href={`/sign-up?next=${encodeURIComponent(`/merchants/${id}`)}`} />}
          aria-label="Block merchant: members only. Create a free account"
          className={cn(base, "text-muted-foreground hover:text-foreground", className)}
        >
          <Lock className="size-4 md:size-3.5" />
          <span className="hidden md:inline">Block</span>
        </TooltipTrigger>
        <TooltipContent>Members can hide this merchant&apos;s ads</TooltipContent>
      </Tooltip>
    );
  }

  const blocked = blocklist.isBlocked(exchange, id);
  return (
    <button
      type="button"
      aria-pressed={blocked}
      aria-label={blocked ? `Unblock ${name}` : `Block ${name}`}
      title={blocked ? "Unblock: show their ads again" : "Block: hide their ads"}
      onClick={() => {
        if (blocked) {
          blocklist.unblock(exchange, id);
          toast(`${name} unblocked`, { duration: 2000 });
        } else {
          blocklist.block({ exchange, id, name, asset, fiat });
          toast(`${name} blocked. Their ads are now hidden.`, {
            duration: 4000,
            action: { label: "Undo", onClick: () => blocklist.unblock(exchange, id) },
          });
        }
      }}
      className={cn(
        base,
        blocked
          ? "border-[color:var(--color-sell)]/40 bg-[color:var(--color-sell)]/10 text-[color:var(--color-sell)]"
          : "text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      <Ban className="size-4 md:size-3.5" />
      <span className="hidden md:inline">{blocked ? "Blocked" : "Block"}</span>
    </button>
  );
}
