"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { LockedRangeChip, useRangeAccess } from "@/components/members/locked-range";

const RANGES = [
  { id: "1h", label: "1H" },
  { id: "6h", label: "6H" },
  { id: "24h", label: "24H" },
  { id: "7d", label: "7D" },
  { id: "30d", label: "30D" },
] as const;

/**
 * URL-backed range switch (`?range=`). Segmented control, keyboard
 * friendly, keeps every other search param. Used by Historical, Liquidity,
 * Risk, Merchant detail and Reports — keep the `value` prop contract.
 * 7D/30D are members only: locked chips link to sign-up. Pass `member`
 * from the server page when known (else the client session decides).
 */
export function RangeTabs({ value, className, member }: { value: string; className?: string; member?: boolean }) {
  const access = useRangeAccess(member);
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();

  function select(r: string) {
    if (r === value) return;
    const next = new URLSearchParams(sp?.toString() ?? "");
    next.set("range", r);
    start(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  return (
    <div
      role="radiogroup"
      aria-label="Time range"
      aria-busy={pending}
      className={cn(
        "inline-flex h-9 items-center gap-0.5 rounded-lg bg-muted p-[3px]",
        pending && "opacity-70",
        className,
      )}
    >
      {RANGES.map((r) => {
        const active = r.id === value;
        if (access.locked(r.id)) {
          return (
            <LockedRangeChip
              key={r.id}
              label={r.label}
              className="h-full min-w-10 rounded-md px-2 font-mono text-xs tabular-nums"
            />
          );
        }
        return (
          <button
            key={r.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => select(r.id)}
            className={cn(
              "inline-flex h-full min-w-10 items-center justify-center rounded-md px-2.5 font-mono text-xs tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-ring",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}
