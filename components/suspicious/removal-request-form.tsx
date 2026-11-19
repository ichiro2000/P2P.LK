"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, ShieldOff } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Turnstile, type TurnstileHandle } from "@/components/common/turnstile";
import { Callout, Field } from "./parts";

const FIELD = "h-10 sm:h-9";

/**
 * Public form on the detail page for asking that a taker be un-flagged. No
 * admin token — an admin reviews every request. Collapsed by default so the
 * page's main signals stay above the fold.
 */
export function RemovalRequestForm({ binanceUserId, displayName }: { binanceUserId: string; displayName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [contact, setContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [humanToken, setHumanToken] = useState<string | null>(null);
  const turnstile = useRef<TurnstileHandle>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      setError("Explain why this flag is mistaken.");
      return;
    }
    if (!humanToken) {
      setError("Complete the human check first.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch("/api/suspicious/removal-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          binanceUserId,
          reason: reason.trim(),
          reporterContact: contact.trim() || null,
          turnstileToken: humanToken,
        }),
      });
      const json = (await r.json()) as { error?: string };
      if (!r.ok) {
        setError(json.error ?? `HTTP ${r.status}`);
        return;
      }
      setSubmitted(true);
      setTimeout(() => {
        router.refresh();
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      // Tokens are single-use; get a fresh one for any retry.
      turnstile.current?.reset();
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <Card className="gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <ShieldOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="space-y-0.5">
            <div className="text-sm font-medium">Think this flag is a mistake?</div>
            <div className="text-xs text-muted-foreground">Ask for removal. An admin reviews every request.</div>
          </div>
        </div>
        <Button type="button" variant="outline" className={FIELD} onClick={() => setOpen(true)}>
          Request removal
        </Button>
      </Card>
    );
  }

  return (
    <Card className="gap-4 py-4">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <ShieldOff className="size-4 text-muted-foreground" />
          <span className="min-w-0 break-words">Request removal for {displayName}</span>
        </CardTitle>
        <CardDescription className="text-xs">
          Explain why this taker shouldn&apos;t be on the list. Nothing is un-flagged until an admin approves it.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Why is this flag mistaken?" htmlFor="rm-reason">
            <Textarea
              id="rm-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="For example: this is my account and the order in the report was completed. Order IDs: …"
              maxLength={1000}
              rows={4}
              className="min-h-24"
            />
          </Field>

          <Field
            label="Contact (optional)"
            htmlFor="rm-contact"
            hint="Lets the admin ask a follow-up question instead of rejecting the request."
          >
            <Input
              id="rm-contact"
              className={FIELD}
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="Email or Telegram handle"
              maxLength={200}
            />
          </Field>

          <Turnstile ref={turnstile} onToken={setHumanToken} />

          {error && <Callout tone="sell" icon={AlertTriangle} title={error} role="alert" />}
          {submitted && (
            <Callout tone="buy" icon={CheckCircle2} title="Request sent. An admin will review it." role="status" />
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              type="button"
              variant="ghost"
              className={FIELD}
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" className={FIELD} disabled={submitting || submitted || !humanToken}>
              {submitting && <Loader2 className="animate-spin" />}
              Send request
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
