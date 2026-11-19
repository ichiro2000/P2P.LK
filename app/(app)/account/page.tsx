import Link from "next/link";
import { ArrowRight, CircleCheck, CircleAlert, LifeBuoy } from "lucide-react";
import { Topbar } from "@/components/shell/topbar";
import { PageBody, PageHeader } from "@/components/common/page";
import { AccountSection, StatusBadge, statusInfo } from "@/components/account/section";
import { ProfileForm } from "@/components/account/profile-form";
import { PasswordForm } from "@/components/account/password-form";
import { SessionsList, SignOutButton } from "@/components/account/sessions-list";
import { NotificationsCard } from "@/components/pwa/notifications-card";
import { isMember, requireViewer } from "@/lib/auth/session";
import { listDeviceSessions } from "@/lib/account";
import { formatSLT } from "@/lib/format";
import { privateMetadata } from "@/lib/seo";

export const metadata = privateMetadata("Account");
export const dynamic = "force-dynamic";

const BTN = "inline-flex h-10 w-fit items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted";

export default async function AccountPage() {
  const viewer = await requireViewer("/account");
  const sessions = await listDeviceSessions(viewer.id).catch(() => []);
  const member = isMember(viewer);
  const status = statusInfo(viewer.status);
  const profile = {
    name: viewer.name,
    merchantName: viewer.merchantName,
    whatsapp: viewer.whatsapp,
    binanceUrl: viewer.binanceUrl ?? "",
    bybitUrl: viewer.bybitUrl ?? "",
  };

  return (
    <>
      <Topbar title="Account" subtitle={viewer.email} />
      <PageBody width="narrow">
        <PageHeader
          title="Profile and security"
          description={`Member since ${formatSLT(viewer.createdAt, { dateStyle: "medium", timeStyle: undefined })}`}
          actions={
            member ? (
              <Link href="/app" className={BTN}>
                Dashboard <ArrowRight className="size-4" aria-hidden />
              </Link>
            ) : undefined
          }
        />

        <AccountSection id="status" title="Account status">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-2">
              <StatusBadge status={viewer.status} />
              <p className="text-sm text-muted-foreground">{status.text}</p>
              {viewer.status === "rejected" && viewer.reviewNote && (
                <div className="rounded-lg border border-[color:var(--color-sell)]/30 bg-[color:var(--color-sell)]/5 px-3 py-2 text-sm">
                  <div className="text-xs font-medium text-[color:var(--color-sell)]">Note from the reviewer</div>
                  <p className="mt-0.5 break-words whitespace-pre-line">{viewer.reviewNote}</p>
                </div>
              )}
              {viewer.role === "admin" && <p className="text-xs text-muted-foreground">You are an admin.</p>}
            </div>
            {!member && (
              <Link href="/account/status" className={BTN}>
                Status details <ArrowRight className="size-4" aria-hidden />
              </Link>
            )}
          </div>
        </AccountSection>

        <AccountSection
          id="profile"
          title="Profile"
          description="Your merchant profile links let the dashboard show your rank on the book, completion and price against the best ad."
        >
          <ProfileForm key={JSON.stringify(profile)} initial={profile} />
        </AccountSection>

        <AccountSection id="email" title="Email">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="truncate font-mono text-sm">{viewer.email}</div>
              <div className="mt-1 inline-flex items-center gap-1.5 text-xs">
                {viewer.emailVerified ? (
                  <>
                    <CircleCheck className="size-3.5 text-[color:var(--color-buy)]" aria-hidden />
                    <span className="text-muted-foreground">Verified</span>
                  </>
                ) : (
                  <>
                    <CircleAlert className="size-3.5 text-[color:var(--color-warn)]" aria-hidden />
                    <span className="text-muted-foreground">Not verified</span>
                  </>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground sm:max-w-56 sm:text-right">
              To change your email, contact support.
            </p>
          </div>
        </AccountSection>

        {member && (
          <AccountSection
            id="notifications"
            title="Notifications"
            description="Alert notifications on your phones and computers. Signing out of a device turns them off there."
          >
            <NotificationsCard />
          </AccountSection>
        )}

        <AccountSection id="password" title="Change password">
          <PasswordForm email={viewer.email} />
        </AccountSection>

        <AccountSection
          id="sessions"
          title="Active sessions"
          description="Devices signed in to your account. Revoke anything you don't recognise, then change your password."
        >
          {sessions.length ? (
            <SessionsList sessions={sessions} />
          ) : (
            <p className="text-sm text-muted-foreground">Couldn&apos;t load your sessions. Refresh to try again.</p>
          )}
        </AccountSection>

        <AccountSection id="sign-out" title="Sign out" description="Sign out of P2P.LK on this device.">
          <SignOutButton />
        </AccountSection>

        <AccountSection id="danger" title="Danger zone" tone="danger">
          <div className="flex items-start gap-3">
            <LifeBuoy className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">
              Contact support to change your email or delete your account. Write from the email on this account so we
              can confirm it&apos;s you.
            </p>
          </div>
        </AccountSection>
      </PageBody>
    </>
  );
}
