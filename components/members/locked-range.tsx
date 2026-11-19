"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Lock } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMemberMode } from "@/hooks/use-member-data";
import { MEMBER_SIGN_UP_HREF, isMemberRange } from "@/lib/member-ranges";
import { cn } from "@/lib/utils";

/**
 * Whether long ranges are unlocked for this viewer. Server pages pass the
 * flag they already computed; otherwise the client session decides.
 */
export function useRangeAccess(member?: boolean) {
  const { isMember } = useMemberMode();
  const unlocked = member ?? isMember;
  return { unlocked, locked: (r: string) => !unlocked && isMemberRange(r) };
}

/** A locked range chip: lock icon, "Members" tooltip, links to sign-up
 *  (and back here afterwards). Styled by the caller to match its group. */
export function LockedRangeChip({ label, className }: { label: React.ReactNode; className?: string }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const next = `${pathname}${sp?.size ? `?${sp.toString()}` : ""}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Link href={`${MEMBER_SIGN_UP_HREF}?next=${encodeURIComponent(next)}`} />}
        aria-label={`${typeof label === "string" ? label : "This range"}: members only. Create a free account`}
        className={cn("inline-flex items-center justify-center gap-1 text-muted-foreground hover:text-foreground", className)}
      >
        <Lock className="size-3" aria-hidden />
        {label}
      </TooltipTrigger>
      <TooltipContent>Members · create a free account</TooltipContent>
    </Tooltip>
  );
}
