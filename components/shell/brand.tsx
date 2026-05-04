import { cn } from "@/lib/utils";

/**
 * Brand wordmark. Intentionally simple:
 *   - Tight monospace tracking
 *   - An emerald micro-dot between "P2P" and "LK" that hints at liveness
 *   - Works on dark surfaces at any size
 */
export function Brand({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 select-none",
        className,
      )}
    >
      <div className="relative flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 ring-1 ring-primary/30">
        <div className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_12px_2px_var(--color-primary)]" />
        <div className="absolute inset-0 rounded-md bg-primary/5 blur-md" />
      </div>
      {!compact && (
        <div className="flex items-baseline font-mono text-[15px] font-semibold tracking-tight">
          <span className="text-foreground">P2P</span>
          <span className="mx-[3px] inline-block h-1 w-1 translate-y-[-2px] rounded-full bg-primary" />
          <span className="text-muted-foreground">WISE</span>
        </div>
      )}
    </div>
  );
}
