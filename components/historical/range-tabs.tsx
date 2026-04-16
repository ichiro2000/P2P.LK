"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

const RANGES = [
  { id: "1h", label: "1h" },
  { id: "6h", label: "6h" },
  { id: "24h", label: "24h" },
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" },
] as const;

export function RangeTabs({ value }: { value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function select(r: string) {
    const next = new URLSearchParams(sp?.toString() ?? "");
    next.set("range", r);
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  }

  return (
    <div
      role="tablist"
      className="inline-flex h-8 items-center rounded-md border border-border bg-card/60 p-1"
    >
      {RANGES.map((r) => {
        const active = r.id === value;
        return (
          <button
            key={r.id}
            role="tab"
            aria-selected={active}
            onClick={() => select(r.id)}
            className={cn(
              "inline-flex h-6 items-center rounded-[5px] px-2.5 font-mono text-[11px] tabular-nums transition-colors",
              active
                ? "bg-primary/15 text-primary"
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
