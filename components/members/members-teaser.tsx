import Link from "next/link";
import { Lock, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Members-only upsell, rendered by the server in place of gated content.
 * Guests get sign-up / sign-in; a signed-in account that isn't approved yet
 * gets a link to its status page.
 */
export function MembersTeaser({
  title,
  description,
  points,
  next,
  pending = false,
  icon: Icon = Lock,
  className,
}: {
  title: string;
  description: string;
  /** Short bullet list of what members get. */
  points?: string[];
  /** Path to come back to after signing in. */
  next: string;
  /** Signed in but not approved yet. */
  pending?: boolean;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <Card className={cn("mx-auto w-full max-w-xl gap-4 px-5 py-6 sm:px-6", className)}>
      <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-border">
        <Icon className="size-4" strokeWidth={1.75} />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-lg font-semibold tracking-tight text-balance">{title}</h2>
        <p className="text-sm text-muted-foreground text-pretty">{description}</p>
      </div>
      {points && points.length > 0 && (
        <ul className="space-y-1.5 text-sm">
          {points.map((p) => (
            <li key={p} className="flex gap-2">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-[color:var(--color-buy)]" aria-hidden />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      )}
      {pending ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Your account is waiting for approval. This unlocks as soon as we approve it.
          </p>
          <Button render={<Link href="/account/status" />} nativeButton={false} variant="outline" className="h-10 w-full sm:w-auto">
            Check account status
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            render={<Link href={`/sign-up?next=${encodeURIComponent(next)}`} />}
            nativeButton={false}
            className="h-10 w-full sm:w-auto"
          >
            Create a free account
          </Button>
          <Button
            render={<Link href={`/sign-in?next=${encodeURIComponent(next)}`} />}
            nativeButton={false}
            variant="outline"
            className="h-10 w-full sm:w-auto"
          >
            Sign in
          </Button>
        </div>
      )}
    </Card>
  );
}
