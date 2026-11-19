"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Turnstile, type TurnstileHandle } from "@/components/common/turnstile";
import { authClient, captchaHeaders } from "@/lib/auth/client";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/auth/validate";
import { EMAIL_RE, authErrorMessage } from "./auth-errors";
import { AuthField, FIELD, FormNote, PasswordInput } from "./fields";

/** Two steps: email (+ Turnstile) → code + new password → /sign-in. */
export function ForgotPasswordForm({ initialEmail }: { initialEmail: string }) {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "reset">("email");
  const [email, setEmail] = useState(initialEmail);
  const [token, setToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Partial<Record<"email" | "code" | "password" | "confirm", string>>>({});
  const turnstile = useRef<TurnstileHandle>(null);

  const cleanEmail = email.trim().toLowerCase();

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!EMAIL_RE.test(cleanEmail)) {
      setFe({ email: cleanEmail ? "Enter a valid email address." : "Enter your email." });
      document.getElementById("fp-email")?.focus();
      return;
    }
    setFe({});
    if (!token) {
      setError("Complete the human check first.");
      return;
    }
    setBusy(true);
    try {
      const { error: err } = await authClient.forgetPassword.emailOtp({ email: cleanEmail }, captchaHeaders(token));
      if (err) {
        setError(authErrorMessage(err));
        return;
      }
      setStep("reset");
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      turnstile.current?.reset();
      setBusy(false);
    }
  }

  async function reset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const errs: typeof fe = {};
    if (!/^\d{6}$/.test(code)) errs.code = "Enter the 6-digit code from the email.";
    if (password.length < PASSWORD_MIN) errs.password = `Use at least ${PASSWORD_MIN} characters.`;
    else if (password.length > PASSWORD_MAX) errs.password = `Use at most ${PASSWORD_MAX} characters.`;
    if (confirm !== password) errs.confirm = "Passwords don't match.";
    setFe(errs);
    const first = (["code", "password", "confirm"] as const).find((k) => errs[k]);
    if (first) {
      document.getElementById(`fp-${first}`)?.focus();
      return;
    }
    setBusy(true);
    try {
      const { error: err } = await authClient.emailOtp.resetPassword({ email: cleanEmail, otp: code, password });
      if (err) {
        setError(authErrorMessage(err));
        return;
      }
      setPassword("");
      setConfirm("");
      router.push(`/sign-in?reset=1&email=${encodeURIComponent(cleanEmail)}`);
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "email") {
    return (
      <form onSubmit={sendCode} noValidate className="space-y-4">
        <AuthField label="Email" htmlFor="fp-email" error={fe.email} hint="We'll email you a 6-digit reset code.">
          <Input
            id="fp-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            className={FIELD}
            value={email}
            aria-invalid={fe.email ? true : undefined}
            aria-describedby="fp-email-msg"
            onChange={(e) => setEmail(e.target.value)}
            maxLength={254}
          />
        </AuthField>
        <Turnstile ref={turnstile} onToken={setToken} />
        {error && (
          <FormNote tone="sell" icon={AlertTriangle}>
            {error}
          </FormNote>
        )}
        <Button type="submit" className="h-10 w-full" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />}
          Send reset code
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={reset} noValidate className="space-y-4">
      <FormNote tone="neutral" icon={MailCheck}>
        If an account exists for <span className="font-medium break-all">{cleanEmail}</span>, a 6-digit code is on its
        way. It expires in 10 minutes.
      </FormNote>

      <AuthField label="Reset code" htmlFor="fp-code" error={fe.code}>
        <Input
          id="fp-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          placeholder="••••••"
          autoFocus
          className="h-12 text-center font-mono text-xl tracking-[0.4em] tabular-nums md:text-xl"
          value={code}
          aria-invalid={fe.code ? true : undefined}
          aria-describedby="fp-code-msg"
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        />
      </AuthField>

      <AuthField label="New password" htmlFor="fp-password" error={fe.password} hint={`At least ${PASSWORD_MIN} characters.`}>
        <PasswordInput
          id="fp-password"
          autoComplete="new-password"
          value={password}
          invalid={!!fe.password}
          onChange={(e) => setPassword(e.target.value)}
          maxLength={PASSWORD_MAX}
        />
      </AuthField>

      <AuthField label="Confirm new password" htmlFor="fp-confirm" error={fe.confirm}>
        <PasswordInput
          id="fp-confirm"
          autoComplete="new-password"
          value={confirm}
          invalid={!!fe.confirm}
          onChange={(e) => setConfirm(e.target.value)}
          maxLength={PASSWORD_MAX}
        />
      </AuthField>

      {error && (
        <FormNote tone="sell" icon={AlertTriangle}>
          {error}
        </FormNote>
      )}

      <Button type="submit" className="h-10 w-full" disabled={busy}>
        {busy && <Loader2 className="animate-spin" />}
        Set new password
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="h-10 w-full"
        onClick={() => {
          setStep("email");
          setCode("");
          setError(null);
          setFe({});
        }}
      >
        <ArrowLeft />
        Use a different email or resend
      </Button>
    </form>
  );
}
