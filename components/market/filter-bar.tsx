"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  ASSETS,
  FIATS,
  PAY_TYPES_BY_FIAT,
  MERCHANT_TYPES,
} from "@/lib/constants";
import { cn } from "@/lib/utils";

export type FilterState = {
  asset: string;
  fiat: string;
  payType: string;
  merchantType: string;
};

/**
 * URL-backed filter bar. All state lives in searchParams so:
 *   - shareable URLs
 *   - back/forward preserves filter
 *   - server components can read current filters without hydration cost
 */
export function FilterBar({
  initial,
  className,
}: {
  initial: FilterState;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const payTypes = useMemo(() => {
    const list = PAY_TYPES_BY_FIAT[initial.fiat.toUpperCase()] ?? [];
    return [{ id: "", label: "All payment methods" }, ...list];
  }, [initial.fiat]);

  function update(patch: Partial<FilterState>) {
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    const merged = { ...initial, ...patch };
    for (const [k, v] of Object.entries(merged)) {
      if (v && v !== "") next.set(k, v);
      else next.delete(k);
    }
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border bg-card/60 p-3 sm:p-4 md:flex-row md:items-end",
        className,
      )}
    >
      <div className="grid grid-cols-2 gap-3 md:flex md:flex-1 md:items-end md:gap-3">
        <FilterField label="Asset">
          <Select
            value={initial.asset}
            onValueChange={(v) => update({ asset: v ?? "USDT" })}
          >
            <SelectTrigger className="w-full min-w-[108px]">
              <SelectValue placeholder="Asset" />
            </SelectTrigger>
            <SelectContent>
              {ASSETS.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterField>

        <FilterField label="Fiat / country">
          <Select
            value={initial.fiat}
            onValueChange={(v) =>
              update({ fiat: v ?? "LKR", payType: "" /* reset rail */ })
            }
          >
            <SelectTrigger className="w-full min-w-[170px]">
              <SelectValue placeholder="Fiat">
                {(val) => {
                  const f = FIATS.find((f) => f.code === val);
                  return f ? (
                    <>
                      <span className="mr-1.5">{f.flag}</span>
                      <span className="font-mono">{f.code}</span>
                    </>
                  ) : (
                    "Fiat"
                  );
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {FIATS.map((f) => (
                <SelectItem key={f.code} value={f.code}>
                  <span className="mr-2">{f.flag}</span>
                  <span className="font-mono">{f.code}</span>
                  <span className="ml-2 text-muted-foreground">
                    {f.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterField>

        <FilterField label="Payment method">
          <Select
            value={initial.payType || ""}
            onValueChange={(v) => update({ payType: v ?? "" })}
          >
            <SelectTrigger className="w-full min-w-[170px]">
              <SelectValue placeholder="All payment methods">
                {(val) =>
                  payTypes.find((p) => p.id === val)?.label ??
                  "All payment methods"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {payTypes.map((p) => (
                <SelectItem key={p.id || "all"} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterField>

        <FilterField label="Publisher">
          <Select
            value={initial.merchantType}
            onValueChange={(v) => update({ merchantType: v ?? "all" })}
          >
            <SelectTrigger className="w-full min-w-[150px]">
              <SelectValue placeholder="Publisher">
                {(val) =>
                  MERCHANT_TYPES.find((m) => m.id === val)?.label ??
                  "Publisher"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {MERCHANT_TYPES.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterField>
      </div>
    </div>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

