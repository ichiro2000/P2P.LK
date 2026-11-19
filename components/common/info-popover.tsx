"use client";

import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Small "i" button that opens an explanation. A popover rather than a
 * tooltip so it also works on touch. `label` names the button for screen
 * readers ("How the reliability score is calculated").
 */
export function InfoPopover({
  label,
  title,
  children,
  className,
  side = "bottom",
}: {
  label: string;
  title?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={label}
        className={cn(
          "-m-2 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2",
          className,
        )}
      >
        <Info className="size-3.5" aria-hidden />
      </PopoverTrigger>
      <PopoverContent side={side} className="w-80 max-w-[calc(100vw-2rem)] gap-1.5 text-xs leading-relaxed">
        {title && <div className="text-sm font-medium">{title}</div>}
        <div className="space-y-1.5 text-muted-foreground">{children}</div>
      </PopoverContent>
    </Popover>
  );
}
