"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Segmented } from "@/components/market/segmented";
import { LockedRangeChip, useRangeAccess } from "@/components/members/locked-range";

const RANGES = ["1h", "6h", "24h", "7d", "30d"] as const;
type Range = (typeof RANGES)[number];
const OPTS = RANGES.map((r) => ({ value: r, label: r, className: "font-mono" }));

/** URL-backed range picker (`?range=`) for the merchant detail charts. */
export function RangeSelect({ value, member }: { value: string; member?: boolean }) {
  const access = useRangeAccess(member);
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const current = (RANGES as readonly string[]).includes(value) ? (value as Range) : "24h";

  const open = OPTS.filter((o) => !access.locked(o.value));
  const locked = RANGES.filter((r) => access.locked(r));

  return (
    <div className="flex items-center gap-1">
      <Segmented
        label="Time range"
        value={current}
        options={open}
        onChange={(r) => {
          const next = new URLSearchParams(sp?.toString() ?? "");
          next.set("range", r);
          router.push(`${pathname}?${next.toString()}`, { scroll: false });
        }}
      />
      {locked.map((r) => (
        <LockedRangeChip
          key={r}
          label={r}
          className="h-10 rounded-md border border-dashed border-border px-2 font-mono text-xs md:h-8"
        />
      ))}
    </div>
  );
}
