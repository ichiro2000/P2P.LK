import { cn } from "@/lib/utils";

export function SectionHeader({
  title,
  description,
  right,
  kicker,
  className,
}: {
  title: string;
  description?: string;
  right?: React.ReactNode;
  kicker?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {kicker && (
          <div className="mb-1.5 flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-1 w-1 rounded-full bg-primary"
            />
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
              {kicker}
            </span>
          </div>
        )}
        <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        {description && (
          <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {right && (
        <div className="flex shrink-0 items-center gap-2">{right}</div>
      )}
    </div>
  );
}
