"use client";

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
  ASSET,
  FIAT,
  BANK_TRANSFER_OPTIONS,
  MERCHANT_TYPES,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import { SaveFilterButton } from "@/components/workspace/save-filter-button";

export type FilterState = {
  asset: string;
  fiat: string;
  /** Empty string means "both bank identifiers"; otherwise a single id. */
  payType: string;
  merchantType: string;
};

/**
 * URL-backed filter bar. Product scope is fixed to USDT / LKR so only two
 * pickers remain: which specific bank identifier to scope to, and whether
 * to restrict to verified merchants.
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
        {/* Asset is locked to USDT — render as a static chip so users get
            immediate context without a 1-option dropdown. */}
        <LockedChip label="Asset" value={ASSET} />

        {/* Fiat is locked to LKR — same treatment. */}
        <LockedChip
          label="Country"
          value={
            <span className="inline-flex items-center gap-1.5 font-mono">
              <span>{FIAT.flag}</span>
              <span>{FIAT.code}</span>
            </span>
          }
        />

        <FilterField label="Bank rail">
          <Select
            value={initial.payType || ""}
            onValueChange={(v) => update({ payType: v ?? "" })}
          >
            <SelectTrigger className="w-full min-w-[200px]">
              <SelectValue placeholder="All bank transfers">
                {(val) => {
                  const opt = BANK_TRANSFER_OPTIONS.find((o) => o.id === val);
                  return opt?.label ?? "All bank transfers";
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All bank transfers</SelectItem>
              {BANK_TRANSFER_OPTIONS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
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
                  MERCHANT_TYPES.find((m) => m.id === val)?.label ?? "Publisher"
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

      <div className="flex shrink-0 items-end justify-end">
        <SaveFilterButton autoLabel={saveLabel(initial)} />
      </div>
    </div>
  );
}

function saveLabel(f: FilterState): string {
  const parts = ["USDT/LKR"];
  const rail = BANK_TRANSFER_OPTIONS.find((o) => o.id === f.payType)?.label;
  if (rail) parts.push(rail);
  if (f.merchantType === "merchant") parts.push("merchants");
  return parts.join(" · ");
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

/**
 * A read-only chip for scope-locked fields (Asset, Fiat). Mirrors the height
 * and density of the Select triggers so the row stays visually aligned.
 */
function LockedChip({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </Label>
      <div className="flex h-8 items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-2.5 text-sm text-foreground">
        {value}
      </div>
    </div>
  );
}
