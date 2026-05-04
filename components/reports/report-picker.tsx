"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { Activity, Users } from "lucide-react";

type ReportKind = "recap" | "merchants";

const KINDS: {
  id: ReportKind;
  label: string;
  description: string;
  icon: typeof Activity;
}[] = [
  {
    id: "recap",
    label: "Daily recap",
    description: "Price, spread, depth & signals over a window",
    icon: Activity,
  },
  {
    id: "merchants",
    label: "Merchant scorecard",
    description: "Counterparty ranking for the Wise USD market",
    icon: Users,
  },
];

export function ReportPicker({ value }: { value: ReportKind }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function select(next: ReportKind) {
    const params = new URLSearchParams(sp?.toString() ?? "");
    params.set("kind", next);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {KINDS.map((k) => {
        const active = k.id === value;
        const Icon = k.icon;
        return (
          <button
            key={k.id}
            type="button"
            onClick={() => select(k.id)}
            aria-pressed={active}
            className={cn(
              "card-lift group relative flex items-start gap-3 rounded-lg border p-4 text-left transition-colors",
              active
                ? "border-primary/40 bg-primary/5"
                : "border-border bg-card/60 hover:border-primary/30",
            )}
          >
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border",
                active
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground",
              )}
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground">
                {k.label}
              </div>
              <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                {k.description}
              </div>
            </div>
            {active && (
              <span
                aria-hidden
                className="absolute inset-y-2 right-0 w-0.5 rounded-l-full bg-primary"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

export type { ReportKind };
