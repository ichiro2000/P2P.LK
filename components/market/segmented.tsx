"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

/**
 * Single-choice segmented control on the shadcn toggle group. Items are
 * 40 px tall on phones (tap target) and compact from `md` up. Clicking the
 * active item keeps it selected.
 */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: React.ReactNode; className?: string }[];
  /** Accessible name for the group. */
  label: string;
  className?: string;
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      onValueChange={(next) => {
        const v = next[0] as T | undefined;
        if (v != null && v !== value) onChange(v);
      }}
      spacing={0}
      variant="outline"
      className={cn("bg-card", className)}
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          className={cn(
            "h-10 min-w-10 px-3 text-xs data-[pressed]:bg-muted data-[pressed]:text-foreground md:h-8 md:min-w-8",
            o.className,
          )}
        >
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
