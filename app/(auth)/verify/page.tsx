import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/auth-card";
import { VerifyForm } from "@/components/auth/verify-form";
import { EMAIL_RE } from "@/components/auth/auth-errors";
import { param } from "@/components/auth/safe-next";
import { getViewer } from "@/lib/auth/session";
import { NOINDEX } from "@/lib/seo";

export const metadata: Metadata = { title: "Verify your email", robots: NOINDEX };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function VerifyPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const viewer = await getViewer();
  if (viewer && viewer.status !== "pending_email") redirect("/account/status");

  const raw = param(sp.email).trim().toLowerCase().slice(0, 254);
  const email = EMAIL_RE.test(raw) ? raw : "";
  return (
    <AuthCard
      title="Check your email"
      description="Enter the 6-digit code we sent you to verify your email."
      footer={
        <>
          Wrong email?{" "}
          <Link href="/sign-up" className="font-medium text-foreground underline-offset-4 hover:underline">
            Sign up again
          </Link>
        </>
      }
    >
      <VerifyForm email={email} initialCode={param(sp.code)} justSent={param(sp.sent) === "1"} />
    </AuthCard>
  );
}
