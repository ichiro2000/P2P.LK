"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowRight, ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Turnstile, type TurnstileHandle } from "@/components/common/turnstile";
import { authClient, captchaHeaders } from "@/lib/auth/client";
import { NAME_MAX, PASSWORD_MAX, PASSWORD_MIN, normalizeLkMobile, normalizeProfileUrl } from "@/lib/auth/validate";
import { cn } from "@/lib/utils";
import { EMAIL_RE, authErrorMessage } from "./auth-errors";
import { AuthField, FIELD, FormNote, PasswordInput } from "./fields";

type Values = {
  name: string;
  merchantName: string;
  whatsapp: string;
  email: string;
  password: string;
  confirm: string;
  binanceUrl: string;
  bybitUrl: string;
};
type Key = keyof Values;

const EMPTY: Values = {
  name: "",
  merchantName: "",
  whatsapp: "",
  email: "",
  password: "",
  confirm: "",
  binanceUrl: "",
  bybitUrl: "",
};

function validate(v: Values): Partial<Record<Key, string>> {
  const e: Partial<Record<Key, string>> = {};
  if (!v.name.trim()) e.name = "Enter your name.";
  else if (v.name.trim().length > NAME_MAX) e.name = `Keep it under ${NAME_MAX} characters.`;
  if (!v.merchantName.trim()) e.merchantName = "Enter the name you trade under.";
  else if (v.merchantName.trim().length > NAME_MAX) e.merchantName = `Keep it under ${NAME_MAX} characters.`;
  if (!v.whatsapp.trim()) e.whatsapp = "Enter your WhatsApp number.";
  else if (!normalizeLkMobile(v.whatsapp)) e.whatsapp = "Use a Sri Lankan mobile number, e.g. 077 123 4567.";
  if (!v.email.trim()) e.email = "Enter your email.";
  else if (!EMAIL_RE.test(v.email.trim())) e.email = "Enter a valid email address.";
  if (!v.password) e.password = "Choose a password.";
  else if (v.password.length < PASSWORD_MIN) e.password = `Use at least ${PASSWORD_MIN} characters.`;
  else if (v.password.length > PASSWORD_MAX) e.password = `Use at most ${PASSWORD_MAX} characters.`;
  if (!v.confirm) e.confirm = "Type the password again.";
  else if (v.confirm !== v.password) e.confirm = "Passwords don't match.";
  if (normalizeProfileUrl(v.binanceUrl, "binance") === null) e.binanceUrl = "Paste a binance.com profile link.";
  if (normalizeProfileUrl(v.bybitUrl, "bybit") === null) e.bybitUrl = "Paste a bybit.com profile link.";
  return e;
}

/** Onboarding is two steps: the account itself, then the merchant details
 *  (plus terms + human check). One sign-up request is sent at the end. */
type Step = 1 | 2;
const STEP_KEYS: Record<Step, Key[]> = {
  1: ["name", "email", "password", "confirm"],
  2: ["merchantName", "whatsapp", "binanceUrl", "bybitUrl"],
};
const STEP_TITLE: Record<Step, string> = { 1: "Your account", 2: "Your merchant details" };
const stepOf = (k: Key): Step => (STEP_KEYS[1].includes(k) ? 1 : 2);

/** Map a server message to the field it is about (the server repeats the
 *  same rules as `validate`, so this only matters for edge cases). */
function fieldFor(code: string | undefined, message: string): Key | null {
  if (code?.startsWith("USER_ALREADY_EXISTS")) return "email";
  const m = message.toLowerCase();
  if (m.includes("whatsapp")) return "whatsapp";
  if (m.includes("merchant name")) return "merchantName";
  if (m.includes("your name")) return "name";
  if (m.includes("binance")) return "binanceUrl";
  if (m.includes("bybit")) return "bybitUrl";
  if (m.includes("password")) return "password";
  if (m.includes("email")) return "email";
  return null;
}

export function SignUpForm() {
  const router = useRouter();
  const [values, setValues] = useState<Values>(EMPTY);
  const [touched, setTouched] = useState<Partial<Record<Key, boolean>>>({});
  const [step, setStep] = useState<Step>(1);
  /** Steps the user has tried to leave/submit — their errors show in full. */
  const [attempted, setAttempted] = useState<Record<Step, boolean>>({ 1: false, 2: false });
  const [serverErr, setServerErr] = useState<{ field: Key | null; message: string; exists?: boolean } | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [agree, setAgree] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const turnstile = useRef<TurnstileHandle>(null);

  const errors = validate(values);
  const show = (k: Key) =>
    (touched[k] || attempted[stepOf(k)] ? errors[k] : undefined) ?? (serverErr?.field === k ? serverErr.message : undefined);

  const focusField = (k: Key) => requestAnimationFrame(() => document.getElementById(`su-${k}`)?.focus());

  /** Step 1 → 2: validate only this step's fields. */
  function onContinue(e: React.FormEvent) {
    e.preventDefault();
    setAttempted((a) => ({ ...a, 1: true }));
    const first = STEP_KEYS[1].find((k) => errors[k]);
    if (first) return focusField(first);
    setServerErr(null);
    setStep(2);
    focusField("merchantName");
  }

  function goBack() {
    setStep(1);
    if (serverErr && !serverErr.field) setServerErr(null);
    focusField("name");
  }

  const bind = (k: Key) => ({
    id: `su-${k}`,
    value: values[k],
    "aria-invalid": show(k) ? true : undefined,
    "aria-describedby": `su-${k}-msg`,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setValues((s) => ({ ...s, [k]: val }));
      if (serverErr?.field === k) setServerErr(null);
    },
    onBlur: () => setTouched((t) => ({ ...t, [k]: true })),
  });

  const normalizedWa = normalizeLkMobile(values.whatsapp);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAttempted({ 1: true, 2: true });
    setServerErr(null);
    const errs = validate(values);
    const first = [...STEP_KEYS[1], ...STEP_KEYS[2]].find((k) => errs[k]);
    if (first) {
      if (stepOf(first) === 1) setStep(1);
      if (first === "binanceUrl" || first === "bybitUrl") setProfileOpen(true);
      return focusField(first);
    }
    if (!agree) {
      setServerErr({ field: null, message: "Please agree to the terms to continue." });
      return;
    }
    if (!token) {
      setServerErr({ field: null, message: "Complete the human check first." });
      return;
    }
    setBusy(true);
    const email = values.email.trim().toLowerCase();
    try {
      const { error } = await authClient.signUp.email(
        {
          name: values.name.trim(),
          merchantName: values.merchantName.trim(),
          whatsapp: normalizedWa ?? values.whatsapp,
          email,
          password: values.password,
          binanceUrl: normalizeProfileUrl(values.binanceUrl, "binance") || undefined,
          bybitUrl: normalizeProfileUrl(values.bybitUrl, "bybit") || undefined,
        },
        captchaHeaders(token),
      );
      if (error) {
        const message = authErrorMessage(error);
        const field = fieldFor(error.code, message);
        setServerErr({ field, message, exists: error.code?.startsWith("USER_ALREADY_EXISTS") });
        if (field === "binanceUrl" || field === "bybitUrl") setProfileOpen(true);
        // An account-step problem (email taken, password rule): go back to it.
        if (field && stepOf(field) === 1) {
          setStep(1);
          focusField(field);
        }
        return;
      }
      router.push(`/verify?email=${encodeURIComponent(email)}&sent=1`);
    } catch {
      setServerErr({ field: null, message: "Network error. Check your connection and try again." });
    } finally {
      // Turnstile tokens are single-use.
      turnstile.current?.reset();
      setBusy(false);
    }
  }

  return (
    <form onSubmit={step === 1 ? onContinue : onSubmit} noValidate className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium" aria-live="polite">
            Step {step} of 2 · {STEP_TITLE[step]}
          </span>
          <span className="text-muted-foreground">{step === 1 ? "Next: merchant details" : "Last step"}</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5" aria-hidden>
          <span className="h-1 rounded-full bg-foreground" />
          <span className={cn("h-1 rounded-full", step === 2 ? "bg-foreground" : "bg-muted")} />
        </div>
      </div>

      {step === 1 ? (
        <>
        <AuthField label="Your name" htmlFor="su-name" error={show("name")}>
          <Input {...bind("name")} className={FIELD} autoComplete="name" autoCapitalize="words" maxLength={NAME_MAX} />
        </AuthField>

        <AuthField
          label="Email"
          htmlFor="su-email"
          error={show("email")}
          hint="We'll send a 6-digit code to verify it."
        >
          <Input
            {...bind("email")}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            className={FIELD}
            maxLength={254}
          />
        </AuthField>
        {serverErr?.exists && (
          <p className="-mt-2 text-xs">
            <Link href={`/sign-in?email=${encodeURIComponent(values.email.trim())}`} className="font-medium underline underline-offset-4">
              Sign in to that account
            </Link>
          </p>
        )}

        <AuthField
          label="Password"
          htmlFor="su-password"
          error={show("password")}
          hint={`At least ${PASSWORD_MIN} characters.`}
        >
          <PasswordInput {...bind("password")} autoComplete="new-password" maxLength={PASSWORD_MAX} invalid={!!show("password")} />
        </AuthField>

        <AuthField label="Confirm password" htmlFor="su-confirm" error={show("confirm")}>
          <PasswordInput {...bind("confirm")} autoComplete="new-password" maxLength={PASSWORD_MAX} invalid={!!show("confirm")} />
        </AuthField>

          <Button type="submit" className="h-10 w-full">
            Continue
            <ArrowRight />
          </Button>
        </>
      ) : (
        <>
        <AuthField
          label="Merchant name"
          htmlFor="su-merchantName"
          error={show("merchantName")}
          hint="The name you trade under on Binance or Bybit."
        >
          <Input
            {...bind("merchantName")}
            className={FIELD}
            autoComplete="organization"
            maxLength={NAME_MAX}
          />
        </AuthField>

        <AuthField
          label="WhatsApp number"
          htmlFor="su-whatsapp"
          error={show("whatsapp")}
          hint={normalizedWa ? `Saved as ${normalizedWa}` : "Sri Lankan mobile, e.g. 077 123 4567."}
        >
          <div className="relative">
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 flex w-12 items-center justify-center border-r border-input font-mono text-sm text-muted-foreground"
            >
              +94
            </span>
            <Input
              {...bind("whatsapp")}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="77 123 4567"
              className={cn(FIELD, "pl-14 font-mono")}
              maxLength={20}
            />
          </div>
        </AuthField>

        <div className="rounded-lg border border-border">
          <button
            type="button"
            onClick={() => setProfileOpen((o) => !o)}
            aria-expanded={profileOpen}
            aria-controls="su-profile"
            className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 text-left text-sm font-medium outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span>
              Add your merchant profile <span className="font-normal text-muted-foreground">(optional)</span>
            </span>
            <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", profileOpen && "rotate-180")} />
          </button>
          {profileOpen && (
            <div id="su-profile" className="space-y-4 border-t border-border px-3 pt-3 pb-4">
              <p className="text-xs text-muted-foreground">
                Linking your profile lets us show your own ranking and trust score once you&apos;re approved.
              </p>
              <AuthField label="Binance profile link" htmlFor="su-binanceUrl" error={show("binanceUrl")}>
                <Input
                  {...bind("binanceUrl")}
                  type="url"
                  inputMode="url"
                  autoComplete="url"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="https://p2p.binance.com/en/advertiserDetail?advertiserNo=…"
                  className={FIELD}
                  maxLength={300}
                />
              </AuthField>
              <AuthField label="Bybit profile link" htmlFor="su-bybitUrl" error={show("bybitUrl")}>
                <Input
                  {...bind("bybitUrl")}
                  type="url"
                  inputMode="url"
                  autoComplete="url"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="https://www.bybit.com/fiat/trade/otc/profile/…"
                  className={FIELD}
                  maxLength={300}
                />
              </AuthField>
            </div>
          )}
        </div>

        <label htmlFor="su-agree" className="flex cursor-pointer items-start gap-3 py-1 text-sm leading-snug">
          <Checkbox
            id="su-agree"
            checked={agree}
            onCheckedChange={(c) => {
              setAgree(c === true);
              if (serverErr && !serverErr.field) setServerErr(null);
            }}
            className="mt-0.5"
          />
          <span className="text-muted-foreground">
            I agree to the P2P.LK terms of use and privacy policy. My details are used to review my account and to
            contact me about it.
          </span>
        </label>

        <Turnstile ref={turnstile} onToken={setToken} />

        {serverErr && !serverErr.field && (
          <FormNote tone="sell" icon={AlertTriangle}>
            {serverErr.message}
          </FormNote>
        )}

          <div className="grid grid-cols-[auto_1fr] gap-2">
            <Button type="button" variant="outline" className="h-10" onClick={goBack} disabled={busy}>
              <ArrowLeft />
              Back
            </Button>
            <Button type="submit" className="h-10" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              Create account
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
