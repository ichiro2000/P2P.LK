"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Bookmark, Check } from "lucide-react";
import { toast } from "sonner";
import { savedFilters } from "@/lib/storage";
import { cn } from "@/lib/utils";

/**
 * Saves the current path + searchParams under a user-supplied label.
 * No modal — we take a sensible auto-label from the filter state and let the
 * user undo via a toast action. Keeps the UI terse and respects the "no crazy
 * animations" brief.
 */
export function SaveFilterButton({
  autoLabel,
  className,
}: {
  /** Label to use if the user hits save without renaming. */
  autoLabel: string;
  className?: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [justSaved, setJustSaved] = useState(false);

  function handle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const search = searchParams?.toString() ?? "";
    const entry = savedFilters.add(autoLabel, pathname ?? "/", search);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1200);
    toast(`Filter saved — ${entry.label}`, {
      duration: 2500,
      action: {
        label: "Undo",
        onClick: () => savedFilters.remove(entry.id),
      },
    });
  }

  return (
    <button
      type="button"
      onClick={handle}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card/50 px-2.5 text-[11px] font-medium text-muted-foreground transition-colors",
        "hover:border-primary/40 hover:text-foreground",
        justSaved && "border-[color:var(--color-buy)]/40 text-[color:var(--color-buy)]",
        className,
      )}
      aria-label="Save current filter"
    >
      {justSaved ? (
        <Check className="h-3.5 w-3.5" strokeWidth={2} />
      ) : (
        <Bookmark className="h-3.5 w-3.5" strokeWidth={1.75} />
      )}
      {justSaved ? "Saved" : "Save filter"}
    </button>
  );
}
