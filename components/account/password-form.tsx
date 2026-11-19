"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { AuthField, FormNote, PasswordInput } from "@/components/auth/fields";
import { authErrorMessage } from "@/components/auth/auth-errors";
import { authClient } from "@/lib/auth/client";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/auth/validate";

type Field = "current" | "next" | "confirm";

export function PasswordForm({ email }: { email: string }) {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [revokeOthers, setRevokeOthers] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ field: Field | null; message: string } | null>(null);

  const fieldError = (k: Field) => (error?.field === k ? error.message : null);
  const clear = (k: Field) => {
    if (error && (error.field === k || error.field === null)) setError(null);
  };

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!current) return setError({ field: "current", message: "Enter your current password." });
    if (next.length < PASSWORD_MIN)
      return setError({ field: "next", message: `Use at least ${PASSWORD_MIN} characters.` });
    if (next.length > PASSWORD_MAX)
      return setError({ field: "next", message: `Use at most ${PASSWORD_MAX} characters.` });
    if (next === current) return setError({ field: "next", message: "Pick a password you haven't used here." });
    if (next !== confirm) return setError({ field: "confirm", message: "The passwords don't match." });

    setPending(true);
    setError(null);
    const { error: err } = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: revokeOthers,
    });
    setPending(false);
    if (err) {
      const message = authErrorMessage(err, "Couldn't change your password. Try again.");
      const wrongCurrent = err.code === "INVALID_PASSWORD" || err.code === "INVALID_EMAIL_OR_PASSWORD";
      setError({
        field: wrongCurrent ? "current" : null,
        message: wrongCurrent ? "That isn't your current password." : message,
      });
      return;
    }
    setCurrent("");
    setNext("");
    setConfirm("");
    toast.success(revokeOthers ? "Password changed. Other devices were signed out." : "Password changed");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {/* Lets password managers attach the new password to the right account. */}
      <input type="email" name="username" autoComplete="username" hidden readOnly value={email} />
      <AuthField label="Current password" htmlFor="pw-current" error={fieldError("current")} className="sm:max-w-sm">
        <PasswordInput
          id="pw-current"
          name="current-password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => {
            setCurrent(e.target.value);
            clear("current");
          }}
          invalid={!!fieldError("current")}
        />
      </AuthField>
      <div className="grid gap-4 sm:grid-cols-2">
        <AuthField
          label="New password"
          htmlFor="pw-new"
          error={fieldError("next")}
          hint={`At least ${PASSWORD_MIN} characters`}
        >
          <PasswordInput
            id="pw-new"
            name="new-password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN}
            maxLength={PASSWORD_MAX}
            value={next}
            onChange={(e) => {
              setNext(e.target.value);
              clear("next");
            }}
            invalid={!!fieldError("next")}
          />
        </AuthField>
        <AuthField label="Confirm new password" htmlFor="pw-confirm" error={fieldError("confirm")}>
          <PasswordInput
            id="pw-confirm"
            name="confirm-password"
            autoComplete="new-password"
            maxLength={PASSWORD_MAX}
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              clear("confirm");
            }}
            invalid={!!fieldError("confirm")}
          />
        </AuthField>
      </div>

      <label className="flex min-h-10 cursor-pointer items-center gap-3 text-sm">
        <Checkbox checked={revokeOthers} onCheckedChange={(c) => setRevokeOthers(Boolean(c))} />
        Sign out my other devices
      </label>

      {error && error.field === null && (
        <FormNote tone="sell" icon={AlertCircle}>
          {error.message}
        </FormNote>
      )}

      <Button type="submit" className="h-10 px-4" disabled={pending}>
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        {pending ? "Changing" : "Change password"}
      </Button>
    </form>
  );
}
