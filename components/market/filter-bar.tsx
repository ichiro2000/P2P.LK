"use client";

import { ALL_PAY_METHODS, PAY_GROUP_LABEL, type PayGroup, type PayTypeOption } from "@/lib/exchanges/types";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ASSET, FIAT, MERCHANT_TYPES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { SaveFilterButton } from "@/components/workspace/save-filter-button";

export type FilterState = {
  asset: string;
  fiat: string;
  /** "" = all bank rails (default), "all" = every method, else one method id. */
  payType: string;
  merchantType: string;
};

const TRIGGER = "w-full min-w-0 data-[size=default]:h-10 lg:w-48 lg:data-[size=default]:h-8";

/**
 * URL-backed filter bar. Scope is fixed to USDT / LKR, so only two pickers
 * remain: payment method and publisher type. Used by several pages — keep the
 * props stable.
 */
export function FilterBar({
  initial,
  payTypes,
  showPayType = true,
  className,
}: {
  initial: FilterState;
  /** Payment methods offered by the active exchange (grouped by `group`). */
  payTypes: PayTypeOption[];
  /** Hide the payment picker where the data covers all rails at once. */
  showPayType?: boolean;
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
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border bg-card p-3 lg:flex-row lg:items-end lg:justify-between",
        className,
      )}
    >
      <div className="grid grid-cols-2 gap-3 lg:flex lg:items-end">
        <div className="hidden min-w-0 flex-col gap-1.5 lg:flex">
          <Label className="text-xs text-muted-foreground">Market</Label>
          <div className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 font-mono text-sm">
            {ASSET}
            <span className="text-muted-foreground">/</span>
            {FIAT.flag} {FIAT.code}
          </div>
        </div>

        {showPayType && (
          <Field label="Payment method">
            <Select value={initial.payType || ""} onValueChange={(v) => update({ payType: v ?? "" })}>
              <SelectTrigger className={TRIGGER} aria-label="Payment method">
                <SelectValue placeholder={DEFAULT_LABEL}>{(val) => selectionLabel(String(val ?? ""), payTypes)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{DEFAULT_LABEL}</SelectItem>
                <SelectItem value={ALL_PAY_METHODS}>{ALL_LABEL}</SelectItem>
                {groupMethods(payTypes).map(([group, items]) => (
                  <SelectGroup key={group}>
                    <SelectSeparator />
                    <SelectLabel>{PAY_GROUP_LABEL[group]}</SelectLabel>
                    {items.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}

        <Field label="Publisher">
          <Select value={initial.merchantType} onValueChange={(v) => update({ merchantType: v ?? "all" })}>
            <SelectTrigger className={TRIGGER} aria-label="Publisher">
              <SelectValue placeholder="Publisher">
                {(val) => MERCHANT_TYPES.find((m) => m.id === val)?.label ?? "Publisher"}
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
        </Field>
      </div>

      {showPayType && initial.payType && (
        <p className="text-xs text-muted-foreground lg:hidden">{METHOD_NOTE}</p>
      )}

      <div className="flex items-center justify-end gap-3">
        {showPayType && initial.payType && (
          <p className="hidden max-w-xs text-right text-xs text-muted-foreground lg:block">{METHOD_NOTE}</p>
        )}
        <SaveFilterButton autoLabel={saveLabel(initial, payTypes)} />
      </div>
    </div>
  );
}

const DEFAULT_LABEL = "All bank transfers";
const ALL_LABEL = "All methods";
const METHOD_NOTE =
  "Each method is its own market: wallet, cash and top-up ads can price far from bank transfers. Live only, no stored history.";
const GROUP_ORDER: PayGroup[] = ["bank", "wallet", "cash", "other"];

function selectionLabel(val: string, payTypes: PayTypeOption[]): string {
  if (val === ALL_PAY_METHODS) return ALL_LABEL;
  return payTypes.find((o) => o.id === val)?.label ?? DEFAULT_LABEL;
}

function groupMethods(payTypes: PayTypeOption[]): [PayGroup, PayTypeOption[]][] {
  return GROUP_ORDER.map((g) => [g, payTypes.filter((p) => (p.group ?? "other") === g)] as [PayGroup, PayTypeOption[]]).filter(
    ([, items]) => items.length > 0,
  );
}

function saveLabel(f: FilterState, payTypes: PayTypeOption[]): string {
  const parts = ["USDT/LKR"];
  if (f.payType) parts.push(selectionLabel(f.payType, payTypes));
  if (f.merchantType === "merchant") parts.push("merchants");
  return parts.join(" · ");
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
