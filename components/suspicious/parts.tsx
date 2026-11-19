import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { formatSLT } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SuspiciousReport } from "@/lib/db/suspicious";

/** Shared pieces for the suspicious-taker registry pages. */

export type Tone = "sell" | "buy" | "warn" | "neutral";

const TONE_BOX: Record<Tone, string> = {
  sell: "border-[color:var(--color-sell)]/40 bg-[color:var(--color-sell)]/5",
  buy: "border-[color:var(--color-buy)]/40 bg-[color:var(--color-buy)]/5",
  warn: "border-[color:var(--color-warn)]/40 bg-[color:var(--color-warn)]/5",
  neutral: "border-border bg-muted/40",
};

const TONE_TEXT: Record<Tone, string> = {
  sell: "text-[color:var(--color-sell)]",
  buy: "text-[color:var(--color-buy)]",
  warn: "text-[color:var(--color-warn)]",
  neutral: "text-foreground",
};

/** Bordered message box: icon + title + body, tinted by tone. */
export function Callout({
  tone = "neutral",
  icon: Icon,
  title,
  children,
  className,
  role,
}: {
  tone?: Tone;
  icon?: LucideIcon;
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  role?: "alert" | "status";
}) {
  return (
    <div role={role} className={cn("flex items-start gap-3 rounded-lg border px-3.5 py-3 text-sm", TONE_BOX[tone], className)}>
      {Icon && <Icon className={cn("mt-0.5 size-4 shrink-0", TONE_TEXT[tone])} aria-hidden />}
      <div className="min-w-0 flex-1 space-y-1">
        {title && <div className={cn("font-medium", TONE_TEXT[tone])}>{title}</div>}
        {children && <div className="text-xs leading-relaxed text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}

/** Label above the field, optional hint below. */
export function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function ReasonBadge({ reason, className }: { reason: string; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("border-[color:var(--color-sell)]/40 text-[color:var(--color-sell)]", className)}
    >
      {reason}
    </Badge>
  );
}

/** One filed report: reason, time, reporter, notes. */
export function ReportItem({ report }: { report: SuspiciousReport }) {
  return (
    <li className="space-y-1 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <ReasonBadge reason={report.reason} />
        <span className="font-mono tabular-nums text-muted-foreground">{formatSLT(report.ts)} SLT</span>
        {report.reporter && <span className="text-muted-foreground">by {report.reporter}</span>}
      </div>
      {report.notes && (
        <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-muted-foreground">{report.notes}</p>
      )}
    </li>
  );
}
