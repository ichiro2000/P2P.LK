"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth/client";
import { authErrorMessage } from "./auth-errors";
import { AuthField, FormNote } from "./fields";

const COOLDOWN = 60;

/**
 * 6-digit email code. Auto-submits when the email link put `?code=` in the
 * URL, or as soon as six digits are typed/pasted. Verifying signs the user
 * in; /account/status then forwards approved accounts (admins) to /app.
 */
export function VerifyForm({ email, initialCode, justSent }: { email: string; initialCode: string; justSent: boolean }) {
  const router = useRouter();
  const linkCode = /^\d{6}$/.test(initialCode) ? initialCode : "";
  const [code, setCode] = useState(linkCode);
  const [busy, setBusy] = useState(!!linkCode);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [left, setLeft] = useState(justSent ? COOLDOWN : 0);
  const [resending, setResending] = useState(false);
  const autoRan = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  // Resend cooldown tick.
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  /** Network part of verifying; only sets state after the await. */
  async function runVerify(otp: string) {
    try {
      const { error: err } = await authClient.emailOtp.verifyEmail({ email, otp });
      if (err) {
        setError(authErrorMessage(err));
        setBusy(false);
        setCode("");
        input.current?.focus();
        return;
      }
      setDone(true);
      router.replace("/account/status");
      router.refresh();
    } catch {
      setError("Network error. Check your connection and try again.");
      setBusy(false);
    }
  }

  // Email link: verify straight away (once, even under StrictMode).
  useEffect(() => {
    if (!linkCode || !email || autoRan.current) return;
    autoRan.current = true;
    void runVerify(linkCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit(otp: string) {
    if (busy || done) return;
    if (!/^\d{6}$/.test(otp)) {
      setError("Enter the 6-digit code from the email.");
      return;
    }
    setError(null);
    setInfo(null);
    setBusy(true);
    void runVerify(otp);
  }

  async function resend() {
    if (left > 0 || resending) return;
    setResending(true);
    setError(null);
    setInfo(null);
    try {
      const { error: err } = await authClient.emailOtp.sendVerificationOtp({ email, type: "email-verification" });
      if (err) {
        setError(authErrorMessage(err, "Couldn't send a new code. Try again in a minute."));
        return;
      }
      setInfo(`New code sent to ${email}. It expires in 10 minutes.`);
      setLeft(COOLDOWN);
      setCode("");
      input.current?.focus();
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setResending(false);
    }
  }

  if (!email) {
    return (
      <div className="space-y-4">
        <FormNote tone="warn" icon={AlertTriangle}>
          This link is missing the email address. Sign in and we&apos;ll send you a new code.
        </FormNote>
        <Button className="h-10 w-full" render={<Link href="/sign-in" />} nativeButton={false}>
          Go to sign in
        </Button>
      </div>
    );
  }

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit(code);
      }}
    >
      <AuthField
        label="Verification code"
        htmlFor="vf-code"
        hint={
          <>
            Sent to <span className="font-medium text-foreground break-all">{email}</span>. Check spam if it isn&apos;t
            there.
          </>
        }
      >
        <Input
          ref={input}
          id="vf-code"
          name="code"
          value={code}
          autoFocus={!linkCode}
          disabled={busy || done}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          placeholder="••••••"
          aria-describedby="vf-code-msg"
          aria-invalid={error ? true : undefined}
          className="h-14 text-center font-mono text-2xl tracking-[0.5em] tabular-nums md:text-2xl"
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
            setCode(digits);
            if (error) setError(null);
            if (digits.length === 6) submit(digits);
          }}
        />
      </AuthField>

      {error && (
        <FormNote tone="sell" icon={AlertTriangle}>
          {error}
        </FormNote>
      )}
      {info && !error && (
        <FormNote tone="buy" icon={CheckCircle2}>
          {info}
        </FormNote>
      )}
      {done && (
        <FormNote tone="buy" icon={CheckCircle2}>
          Email verified. Taking you to your account…
        </FormNote>
      )}

      <Button type="submit" className="h-11 w-full" disabled={busy || done || code.length !== 6}>
        {(busy || done) && <Loader2 className="animate-spin" />}
        {busy && !done ? "Verifying…" : "Verify email"}
      </Button>

      <div className="flex flex-col items-center gap-1 pt-1 text-sm sm:flex-row sm:justify-between">
        <span className="text-muted-foreground">Didn&apos;t get it?</span>
        <Button
          type="button"
          variant="ghost"
          className="h-10 px-3"
          onClick={resend}
          disabled={left > 0 || resending || done}
          aria-live="polite"
        >
          {resending && <Loader2 className="animate-spin" />}
          {left > 0 ? `Resend code in ${left}s` : "Resend code"}
        </Button>
      </div>
    </form>
  );
}
