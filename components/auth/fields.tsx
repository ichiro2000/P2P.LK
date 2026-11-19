"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export const FIELD = "h-10";

/** Label above the control, then a hint or an inline error below. */
export function AuthField({
  label,
  htmlFor,
  hint,
  error,
  aside,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: React.ReactNode;
  error?: string | null;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={htmlFor}>{label}</Label>
        {aside}
      </div>
      {children}
      {error ? (
        <p id={`${htmlFor}-msg`} className="text-xs text-[color:var(--color-sell)]" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-msg`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Password input with a show/hide toggle. */
export function PasswordInput({
  id,
  className,
  invalid,
  ...props
}: Omit<React.ComponentProps<"input">, "type"> & { id: string; invalid?: boolean }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={shown ? "text" : "password"}
        aria-invalid={invalid || undefined}
        aria-describedby={`${id}-msg`}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={cn(FIELD, "pr-10", className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

/** Form-level message box (error / success / info). */
export function FormNote({
  tone,
  icon: Icon,
  children,
}: {
  tone: "sell" | "buy" | "warn" | "neutral";
  icon?: LucideIcon;
  children: React.ReactNode;
}) {
  const box = {
    sell: "border-[color:var(--color-sell)]/40 bg-[color:var(--color-sell)]/5",
    buy: "border-[color:var(--color-buy)]/40 bg-[color:var(--color-buy)]/5",
    warn: "border-[color:var(--color-warn)]/40 bg-[color:var(--color-warn)]/5",
    neutral: "border-border bg-muted/40",
  }[tone];
  const text = {
    sell: "text-[color:var(--color-sell)]",
    buy: "text-[color:var(--color-buy)]",
    warn: "text-[color:var(--color-warn)]",
    neutral: "text-muted-foreground",
  }[tone];
  return (
    <div
      role={tone === "sell" ? "alert" : "status"}
      className={cn("flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm", box)}
    >
      {Icon && <Icon className={cn("mt-0.5 size-4 shrink-0", text)} aria-hidden />}
      <div className="min-w-0 flex-1 text-foreground">{children}</div>
    </div>
  );
}
