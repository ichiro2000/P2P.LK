"use client";

import { Field as FieldPrimitive } from "@base-ui/react/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EXCHANGE_IDS, type ExchangeId, type PayTypeOption } from "@/lib/exchanges/types";
import type { LiveBooks } from "@/lib/compare";
import { cn } from "@/lib/utils";

/** Small labelled field used by the constructor and the arbitrage tools. */
export function Field({
  label,
  children,
  className,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    // Base UI Field ties the label to the Input / Select inside it.
    <FieldPrimitive.Root className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <FieldPrimitive.Label className="text-[11px] font-medium text-muted-foreground">{label}</FieldPrimitive.Label>
      {children}
    </FieldPrimitive.Root>
  );
}

export function ExchangeToggle({
  value,
  onChange,
  books,
}: {
  value: ExchangeId;
  onChange: (ex: ExchangeId) => void;
  books: LiveBooks;
}) {
  return (
    <ToggleGroup
      value={[value]}
      onValueChange={(v) => v[0] && onChange(v[0] as ExchangeId)}
      variant="outline"
      size="sm"
      spacing={0}
      aria-label="Exchange"
      className="w-full"
    >
      {EXCHANGE_IDS.map((ex) => (
        <ToggleGroupItem key={ex} value={ex} className="flex-1 text-xs">
          {books[ex]?.label ?? ex}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function PayMethodSelect({
  value,
  onChange,
  options,
  allLabel = "All bank rails",
}: {
  value: string;
  onChange: (v: string) => void;
  options: PayTypeOption[];
  allLabel?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(String(v ?? ""))}>
      <SelectTrigger size="sm" className="w-full min-w-0">
        <SelectValue placeholder={allLabel}>
          {(val) => options.find((o) => o.id === val)?.label ?? allLabel}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="">{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
