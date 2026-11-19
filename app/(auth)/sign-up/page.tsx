import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { safeNext } from "@/components/auth/safe-next";
import { getViewer, isMember, statusPath } from "@/lib/auth/session";
import { getFlags } from "@/lib/flags";
import { NOINDEX } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Create your account",
  description: "Free P2P.LK merchant account: dashboard, server-side price alerts and CSV reports.",
  robots: NOINDEX,
};

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function SignUpPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const [viewer, flags] = await Promise.all([getViewer(), getFlags()]);
  if (viewer) redirect(isMember(viewer) ? (safeNext(sp.next) ?? "/app") : statusPath(viewer));

  return (
    <AuthCard
      title="Create your free account"
      description="Two quick steps: your account, then your merchant details. We review every account, usually within a day."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/sign-in" className="font-medium text-foreground underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      {flags.signupsOpen ? (
        <SignUpForm />
      ) : (
        <div role="status" className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
          <p className="font-medium">Sign-ups are paused</p>
          <p className="mt-1 text-muted-foreground">
            We&apos;re not taking new accounts right now. Please check back soon. Market pages stay open to everyone.
          </p>
        </div>
      )}
    </AuthCard>
  );
}
