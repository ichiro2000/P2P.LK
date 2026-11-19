"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthField, FIELD, FormNote } from "@/components/auth/fields";
import { authErrorMessage } from "@/components/auth/auth-errors";
import { authClient } from "@/lib/auth/client";
import { binanceAdvertiserId, bybitAdvertiserId } from "@/lib/merchant-link";

export type ProfileValues = {
  name: string;
  merchantName: string;
  whatsapp: string;
  binanceUrl: string;
  bybitUrl: string;
};

type Field = keyof ProfileValues;

/** Which field a server message is about (the server validates; we only place the error). */
function fieldFor(message: string): Field | null {
  const m = message.toLowerCase();
  if (m.includes("whatsapp")) return "whatsapp";
  if (m.includes("binance")) return "binanceUrl";
  if (m.includes("bybit")) return "bybitUrl";
  if (m.includes("merchant name")) return "merchantName";
  if (m.includes("name")) return "name";
  return null;
}

/**
 * Profile edit form. The server normalises and validates every field
 * (lib/auth/config.ts user.update hook); its message is shown as-is. The
 * page remounts this form (via `key`) after a save so the normalised values
 * (e.g. +94… WhatsApp) come back from the server.
 */
export function ProfileForm({ initial }: { initial: ProfileValues }) {
  const router = useRouter();
  const [v, setV] = useState<ProfileValues>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ field: Field | null; message: string } | null>(null);

  const dirty = (Object.keys(initial) as Field[]).some((k) => v[k].trim() !== initial[k].trim());
  const set = (k: Field) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setV((s) => ({ ...s, [k]: value }));
    if (error?.field === k || error?.field === null) setError(null);
  };

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!v.name.trim()) return setError({ field: "name", message: "Enter your name." });
    if (!v.merchantName.trim()) return setError({ field: "merchantName", message: "Enter your merchant name." });
    if (!v.whatsapp.trim()) return setError({ field: "whatsapp", message: "Enter your WhatsApp number." });
    setPending(true);
    setError(null);
    const { error: err } = await authClient.updateUser({
      name: v.name.trim(),
      merchantName: v.merchantName.trim(),
      whatsapp: v.whatsapp.trim(),
      binanceUrl: v.binanceUrl.trim(),
      bybitUrl: v.bybitUrl.trim(),
    });
    setPending(false);
    if (err) {
      const message = authErrorMessage(err, "Couldn't save your profile. Try again.");
      setError({ field: fieldFor(message), message });
      return;
    }
    toast.success("Profile saved");
    router.refresh();
  }

  const fieldError = (k: Field) => (error?.field === k ? error.message : null);
  const bId = v.binanceUrl.trim() ? binanceAdvertiserId(v.binanceUrl.trim()) : null;
  const yId = v.bybitUrl.trim() ? bybitAdvertiserId(v.bybitUrl.trim()) : null;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <AuthField label="Your name" htmlFor="pf-name" error={fieldError("name")}>
          <Input
            id="pf-name"
            name="name"
            autoComplete="name"
            maxLength={80}
            value={v.name}
            onChange={set("name")}
            aria-invalid={!!fieldError("name") || undefined}
            aria-describedby="pf-name-msg"
            className={FIELD}
          />
        </AuthField>
        <AuthField label="Merchant name" htmlFor="pf-merchant" error={fieldError("merchantName")} hint="As shown on your ads">
          <Input
            id="pf-merchant"
            name="merchantName"
            autoComplete="organization"
            maxLength={80}
            value={v.merchantName}
            onChange={set("merchantName")}
            aria-invalid={!!fieldError("merchantName") || undefined}
            aria-describedby="pf-merchant-msg"
            className={FIELD}
          />
        </AuthField>
      </div>

      <AuthField
        label="WhatsApp number"
        htmlFor="pf-whatsapp"
        error={fieldError("whatsapp")}
        hint="Sri Lankan mobile, e.g. 077 123 4567"
        className="sm:max-w-xs"
      >
        <Input
          id="pf-whatsapp"
          name="whatsapp"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={v.whatsapp}
          onChange={set("whatsapp")}
          aria-invalid={!!fieldError("whatsapp") || undefined}
          aria-describedby="pf-whatsapp-msg"
          className={FIELD}
        />
      </AuthField>

      <AuthField
        label="Binance advertiser link"
        htmlFor="pf-binance"
        error={fieldError("binanceUrl")}
        hint={
          bId ? (
            <>
              Advertiser id <span className="font-mono break-all">{bId}</span>
            </>
          ) : v.binanceUrl.trim() ? (
            "We can't see an advertiserNo= in this link. Copy it from your profile page."
          ) : (
            "Optional. p2p.binance.com/en/advertiserDetail?advertiserNo=…"
          )
        }
      >
        <Input
          id="pf-binance"
          name="binanceUrl"
          type="url"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="https://p2p.binance.com/en/advertiserDetail?advertiserNo=…"
          value={v.binanceUrl}
          onChange={set("binanceUrl")}
          aria-invalid={!!fieldError("binanceUrl") || undefined}
          aria-describedby="pf-binance-msg"
          className={FIELD}
        />
      </AuthField>

      <AuthField
        label="Bybit advertiser link"
        htmlFor="pf-bybit"
        error={fieldError("bybitUrl")}
        hint={
          yId ? (
            <>
              Advertiser id <span className="font-mono break-all">{yId}</span>
            </>
          ) : v.bybitUrl.trim() ? (
            "We can't see a profile id in this link. Use the bybit.com/…/p2p/profile/… link."
          ) : (
            "Optional. bybit.com/en/p2p/profile/…/USDT/LKR/item"
          )
        }
      >
        <Input
          id="pf-bybit"
          name="bybitUrl"
          type="url"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="https://www.bybit.com/en/p2p/profile/…"
          value={v.bybitUrl}
          onChange={set("bybitUrl")}
          aria-invalid={!!fieldError("bybitUrl") || undefined}
          aria-describedby="pf-bybit-msg"
          className={FIELD}
        />
      </AuthField>

      {error && error.field === null && (
        <FormNote tone="sell" icon={AlertCircle}>
          {error.message}
        </FormNote>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" className="h-10 px-4" disabled={pending || !dirty}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {pending ? "Saving" : "Save profile"}
        </Button>
        {dirty && !pending && (
          <Button
            type="button"
            variant="ghost"
            className="h-10 px-3"
            onClick={() => {
              setV(initial);
              setError(null);
            }}
          >
            Discard changes
          </Button>
        )}
      </div>
    </form>
  );
}
