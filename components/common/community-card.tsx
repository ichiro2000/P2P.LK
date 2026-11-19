import { ExternalLink, MessagesSquare } from "lucide-react";
import { COMMUNITY_WHATSAPP_URL } from "@/lib/constants";
import { cn } from "@/lib/utils";

/** "Join the WhatsApp community" call to action (onboarding end, dashboard). */
export function CommunityCard({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-3 rounded-lg border border-border px-3.5 py-3 sm:flex-row sm:items-center", className)}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <MessagesSquare className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 space-y-0.5">
          <div className="text-sm font-medium">Join the P2P.LK community</div>
          {!compact && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Market updates, new features and announcements in our WhatsApp group.
            </p>
          )}
        </div>
      </div>
      <a
        href={COMMUNITY_WHATSAPP_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-md bg-foreground px-3.5 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        Join on WhatsApp
        <ExternalLink className="size-3.5" aria-hidden />
        <span className="sr-only"> (opens WhatsApp)</span>
      </a>
    </div>
  );
}
