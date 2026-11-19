"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import {
  LockedRangeChip,
  useRangeAccess,
} from "@/components/members/locked-range";

/** Range tabs that live in the URL (`?range=`), so links are shareable and
 *  the server renders the new range's history. */
export function RangeSwitch({
  value,
  options,
  member,
}: {
  value: string;
  options: readonly string[];
  /** Server-known membership; 7d/30d lock for non-members. */
  member?: boolean;
}) {
  const access = useRangeAccess(member);
  const open = options.filter((r) => !access.locked(r));
  const locked = options.filter((r) => access.locked(r));
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-1">
      <ToggleGroup
        value={[value]}
        onValueChange={(v) => {
          const next = v[0];
          if (!next || next === value) return;
          const q = new URLSearchParams(sp?.toString() ?? "");
          q.set("range", next);
          startTransition(() =>
            router.replace(`${pathname}?${q.toString()}`, { scroll: false }),
          );
        }}
        variant="outline"
        size="sm"
        spacing={0}
        aria-label="Time range"
        className={cn(pending && "opacity-60")}
      >
        {open.map((r) => (
          <ToggleGroupItem
            key={r}
            value={r}
            className="px-2.5 font-mono text-xs tabular-nums"
          >
            {r}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {locked.map((r) => (
        <LockedRangeChip
          key={r}
          label={r}
          className="h-7 rounded-md border border-dashed border-border px-2 font-mono text-xs"
        />
      ))}
    </div>
  );
}
