import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { param } from "@/components/auth/safe-next";
import { NOINDEX } from "@/lib/seo";

export const metadata: Metadata = { title: "Reset your password", robots: NOINDEX };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function ForgotPasswordPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  return (
    <AuthCard
      title="Reset your password"
      description="We'll email you a code to set a new one."
      footer={
        <>
          Remembered it?{" "}
          <Link href="/sign-in" className="font-medium text-foreground underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <ForgotPasswordForm initialEmail={param(sp.email).slice(0, 254)} />
    </AuthCard>
  );
}
