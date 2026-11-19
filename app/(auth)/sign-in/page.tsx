import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { SignInForm } from "@/components/auth/sign-in-form";
import { param, safeNext } from "@/components/auth/safe-next";
import { getViewer, isMember, statusPath } from "@/lib/auth/session";
import { NOINDEX } from "@/lib/seo";

export const metadata: Metadata = { title: "Sign in", robots: NOINDEX };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function SignInPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const viewer = await getViewer();
  if (viewer) redirect(isMember(viewer) ? (next ?? "/app") : statusPath(viewer));

  const signUpHref = next ? `/sign-up?next=${encodeURIComponent(next)}` : "/sign-up";
  return (
    <AuthCard
      title="Sign in"
      description="Your dashboard, alerts and reports on P2P.LK."
      footer={
        <>
          New here?{" "}
          <Link href={signUpHref} className="font-medium text-foreground underline-offset-4 hover:underline">
            Create a free account
          </Link>
        </>
      }
    >
      <SignInForm
        next={next}
        initialEmail={param(sp.email).slice(0, 254)}
        notice={param(sp.reset) === "1" ? "reset" : null}
      />
    </AuthCard>
  );
}
