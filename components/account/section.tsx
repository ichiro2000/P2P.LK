import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { UserStatus } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

/** One settings block: heading + description on the left/top, body below. */
export function AccountSection({
  id,
  title,
  description,
  children,
  tone,
}: {
  id?: string;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  tone?: "danger";
}) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className="scroll-mt-20">
      <Card
        className={cn(
          "gap-4 px-4 py-4 sm:px-5 sm:py-5",
          tone === "danger" && "ring-[color:var(--color-sell)]/30",
        )}
      >
        <div className="space-y-1">
          <h3
            id={id ? `${id}-title` : undefined}
            className={cn("text-base font-semibold tracking-tight", tone === "danger" && "text-[color:var(--color-sell)]")}
          >
            {title}
          </h3>
          {description && <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>}
        </div>
        {children}
      </Card>
    </section>
  );
}

const STATUS: Record<UserStatus, { label: string; tone: "buy" | "warn" | "sell"; text: string }> = {
  approved: { label: "Approved", tone: "buy", text: "Your account is approved. Everything is unlocked." },
  pending_email: { label: "Email not verified", tone: "warn", text: "Verify your email to send your account for review." },
  pending_review: {
    label: "Under review",
    tone: "warn",
    text: "An admin is checking your details. We'll email you when it's done.",
  },
  rejected: { label: "Not approved", tone: "sell", text: "Your account wasn't approved." },
  suspended: { label: "Suspended", tone: "sell", text: "This account has been switched off by an admin." },
};

export function statusInfo(s: UserStatus) {
  return STATUS[s] ?? STATUS.pending_review;
}

export function StatusBadge({ status }: { status: UserStatus }) {
  const s = statusInfo(status);
  const dot = {
    buy: "bg-[color:var(--color-buy)]",
    warn: "bg-[color:var(--color-warn)]",
    sell: "bg-[color:var(--color-sell)]",
  }[s.tone];
  return (
    <Badge variant="outline" className="gap-1.5">
      <span className={cn("size-1.5 rounded-full", dot)} aria-hidden />
      {s.label}
    </Badge>
  );
}
