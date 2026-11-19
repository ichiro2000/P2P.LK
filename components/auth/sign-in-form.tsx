"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, MailWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Turnstile, type TurnstileHandle } from "@/components/common/turnstile";
import { authClient, captchaHeaders } from "@/lib/auth/client";
import { EMAIL_RE, authErrorMessage } from "./auth-errors";
import { AuthField, FIELD, FormNote, PasswordInput } from "./fields";

/**
 * Email + password + Turnstile. Routes by account status afterwards:
 * approved → `next` (already sanitised by the page) or /app; anything else →
 * /account/status. An unverified email gets a "send a new code" offer.
 */
export function SignInForm({
  next,
  initialEmail,
  notice,
}: {
  next: string | null;
  initialEmail: string;
  notice?: "reset" | null;
}) {
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<{ email?: string; password?: string }>({});
  const [unverified, setUnverified] = useState(false);
  const [resending, setResending] = useState(false);
  const turnstile = useRef<TurnstileHandle>(null);

  const cleanEmail = email.trim().toLowerCase();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setUnverified(false);
    const fe: typeof fieldErr = {};
    if (!cleanEmail) fe.email = "Enter your email.";
    else if (!EMAIL_RE.test(cleanEmail)) fe.email = "Enter a valid email address.";
    if (!password) fe.password = "Enter your password.";
    setFieldErr(fe);
    if (fe.email || fe.password) {
      document.getElementById(fe.email ? "si-email" : "si-password")?.focus();
      return;
    }
    if (!token) {
      setError("Complete the human check first.");
      return;
    }
    setBusy(true);
    try {
      const { data, error: err } = await authClient.signIn.email(
        { email: cleanEmail, password, rememberMe: true },
        captchaHeaders(token),
      );
      if (err) {
        if (err.code === "EMAIL_NOT_VERIFIED") {
          setUnverified(true);
          return;
        }
        setError(authErrorMessage(err));
        return;
      }
      const status = (data?.user as { status?: string; role?: string } | undefined)?.status;
      const role = (data?.user as { role?: string } | undefined)?.role;
      setPassword("");
      router.push(status === "approved" || role === "admin" ? (next ?? "/app") : "/account/status");
      router.refresh();
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      turnstile.current?.reset();
      setBusy(false);
    }
  }

  async function resend() {
    setResending(true);
    setError(null);
    try {
      const { error: err } = await authClient.emailOtp.sendVerificationOtp({
        email: cleanEmail,
        type: "email-verification",
      });
      if (err) {
        setError(authErrorMessage(err, "Couldn't send a new code. Try again in a minute."));
        return;
      }
      router.push(`/verify?email=${encodeURIComponent(cleanEmail)}&sent=1`);
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setResending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {notice === "reset" && (
        <FormNote tone="buy" icon={CheckCircle2}>
          Password changed. Sign in with your new password.
        </FormNote>
      )}

      <AuthField label="Email" htmlFor="si-email" error={fieldErr.email}>
        <Input
          id="si-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          className={FIELD}
          value={email}
          aria-invalid={fieldErr.email ? true : undefined}
          aria-describedby="si-email-msg"
          onChange={(e) => {
            setEmail(e.target.value);
            setUnverified(false);
          }}
          maxLength={254}
        />
      </AuthField>

      <AuthField
        label="Password"
        htmlFor="si-password"
        error={fieldErr.password}
        aside={
          <Link
            href={cleanEmail ? `/forgot-password?email=${encodeURIComponent(cleanEmail)}` : "/forgot-password"}
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Forgot password?
          </Link>
        }
      >
        <PasswordInput
          id="si-password"
          autoComplete="current-password"
          value={password}
          invalid={!!fieldErr.password}
          onChange={(e) => setPassword(e.target.value)}
          maxLength={128}
        />
      </AuthField>

      <Turnstile ref={turnstile} onToken={setToken} />

      {unverified && (
        <FormNote tone="warn" icon={MailWarning}>
          <div className="space-y-2">
            <p>Your email isn&apos;t verified yet. We&apos;ll send a new 6-digit code to {cleanEmail}.</p>
            <Button type="button" variant="outline" className="h-10 w-full sm:w-auto" onClick={resend} disabled={resending}>
              {resending && <Loader2 className="animate-spin" />}
              Send code and verify
            </Button>
          </div>
        </FormNote>
      )}

      {error && (
        <FormNote tone="sell" icon={AlertTriangle}>
          {error}
        </FormNote>
      )}

      <Button type="submit" className="h-10 w-full" disabled={busy}>
        {busy && <Loader2 className="animate-spin" />}
        Sign in
      </Button>
    </form>
  );
}
