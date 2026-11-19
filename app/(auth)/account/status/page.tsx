import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Ban, CheckCircle2, Clock, MailCheck, ShieldCheck, XCircle } from "lucide-react";
import { AuthCard } from "@/components/auth/auth-card";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { CommunityCard } from "@/components/common/community-card";
import { requireViewer, statusPath } from "@/lib/auth/session";
import { cn } from "@/lib/utils";
import { NOINDEX_NOFOLLOW } from "@/lib/seo";

export const metadata: Metadata = { title: "Account status", robots: NOINDEX_NOFOLLOW };
export const dynamic = "force-dynamic";

function Step({ done, current, title, children }: { done?: boolean; current?: boolean; title: string; children?: React.ReactNode }) {
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      <span
        aria-hidden
        className={cn(
          "relative z-10 mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
          done && "border-foreground bg-foreground text-background",
          current && "border-foreground bg-background",
          !done && !current && "border-border bg-background",
        )}
      >
        {done ? <CheckCircle2 className="size-3.5" /> : current ? <span className="size-2 rounded-full bg-foreground" /> : null}
      </span>
      <div className="min-w-0 space-y-0.5">
        <div className={cn("text-sm font-medium", !done && !current && "text-muted-foreground")}>
          {title}
          {current && <span className="sr-only"> (current step)</span>}
        </div>
        {children && <div className="text-xs leading-relaxed text-muted-foreground">{children}</div>}
      </div>
    </li>
  );
}

export default async function AccountStatusPage() {
  const v = await requireViewer("/account/status");
  if (v.status === "pending_email") redirect(statusPath(v));
  // (isMember is a type guard that would narrow v to never below.)
  if (v.status === "approved" || v.role === "admin") redirect("/app");

  const first = v.name.split(/\s+/)[0] || "there";

  if (v.status === "rejected") {
    return (
      <AuthCard title="Your application wasn't approved" description={`Sorry, ${first}. Here's what the reviewer said.`}>
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-[color:var(--color-sell)]/40 bg-[color:var(--color-sell)]/5 px-3.5 py-3">
            <XCircle className="mt-0.5 size-4 shrink-0 text-[color:var(--color-sell)]" aria-hidden />
            <div className="min-w-0 space-y-1 text-sm">
              <div className="font-medium">Reviewer&apos;s note</div>
              <p className="whitespace-pre-line break-words text-muted-foreground">
                {v.reviewNote?.trim() || "No reason was given."}
              </p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            If something was missing or wrong, reply to the email we sent you with the details and we&apos;ll take
            another look. The live markets stay free to use without an account.
          </p>
          <SignOutButton className="w-full" />
        </div>
      </AuthCard>
    );
  }

  if (v.status === "suspended") {
    return (
      <AuthCard title="Account suspended" description="Your P2P.LK account is currently suspended.">
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-[color:var(--color-warn)]/40 bg-[color:var(--color-warn)]/5 px-3.5 py-3">
            <Ban className="mt-0.5 size-4 shrink-0 text-[color:var(--color-warn)]" aria-hidden />
            <p className="text-sm text-muted-foreground">
              Member features are turned off while the account is suspended. If you think this is a mistake, reply to
              any email from P2P.LK and an admin will look into it.
            </p>
          </div>
          {v.reviewNote?.trim() && (
            <p className="whitespace-pre-line break-words rounded-lg border border-border bg-muted/40 px-3.5 py-3 text-sm text-muted-foreground">
              {v.reviewNote}
            </p>
          )}
          <SignOutButton className="w-full" />
        </div>
      </AuthCard>
    );
  }

  // pending_review
  return (
    <AuthCard
      title="Thanks, we're reviewing your account"
      description={`Hi ${first}, your email is verified. We'll email ${v.email} as soon as an admin has looked at it.`}
    >
      <div className="space-y-5">
        <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 px-3.5 py-3">
          <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">
            Reviews usually take less than a day. You don&apos;t need to do anything else. Live markets, merchants and
            history stay open to you meanwhile.
          </p>
        </div>

        <ol className="relative before:absolute before:top-2 before:bottom-2 before:left-2.5 before:w-px before:bg-border">
          <Step done title="Account created">
            {v.merchantName} · {v.whatsapp}
          </Step>
          <Step done title="Email verified" />
          <Step current title="Admin review">We check your merchant details and WhatsApp number.</Step>
          <Step title="You're in">
            Dashboard, server-side price alerts that email you, saved watchlists and CSV reports.
          </Step>
        </ol>

        <CommunityCard />

        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <MailCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>Add our address to your contacts so the approval email doesn&apos;t land in spam.</span>
        </div>
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>We never ask for your exchange password or 2FA codes.</span>
        </div>

        <SignOutButton className="w-full" />
      </div>
    </AuthCard>
  );
}
