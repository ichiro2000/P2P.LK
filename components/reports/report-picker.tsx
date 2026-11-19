"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Activity, Users } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
    description: "Price, spread, depth and risk signals over the chosen window, from the ingested history.",
    icon: Activity,
  },
  {
    id: "merchants",
    label: "Merchant scorecard",
    description: "Every merchant on the live book, ranked by a reliability score.",
    icon: Users,
  },
];

/** Segmented switch between report types; keeps other query params. */
export function ReportPicker({ value }: { value: ReportKind }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const active = KINDS.find((k) => k.id === value) ?? KINDS[0];

  function select(next: ReportKind) {
    const params = new URLSearchParams(sp?.toString() ?? "");
    params.set("kind", next);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="space-y-2">
      <Tabs value={value} onValueChange={(v) => select(v as ReportKind)}>
        <TabsList className="h-10 w-full sm:h-9 sm:w-fit" aria-label="Report type">
          {KINDS.map((k) => {
            const Icon = k.icon;
            return (
              <TabsTrigger key={k.id} value={k.id} className="px-3">
                <Icon />
                {k.label}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>
      <p className="text-xs text-muted-foreground">{active.description}</p>
    </div>
  );
}

export type { ReportKind };
