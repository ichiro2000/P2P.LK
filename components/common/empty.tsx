import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export function Empty({
  icon: Icon,
  title,
  description,
  action,
  className,
  tone = "neutral",
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  tone?: "neutral" | "warn" | "error";
}) {
  const toneColor =
    tone === "warn"
      ? "text-[color:var(--color-warn)]"
      : tone === "error"
        ? "text-[color:var(--color-sell)]"
        : "text-muted-foreground";

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed border-border/60 bg-card/30 px-6 py-12 text-center",
        className,
      )}
    >
      {Icon && (
        <div
          className={cn(
            "mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted/50 ring-1 ring-border",
            toneColor,
          )}
        >
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </div>
      )}
      <div className="text-sm font-medium text-foreground">{title}</div>
      {description && (
        <div className="mt-1.5 max-w-sm text-[12px] leading-relaxed text-muted-foreground">
          {description}
        </div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
