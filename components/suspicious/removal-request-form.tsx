"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, CheckCircle2, Loader2, ShieldOff } from "lucide-react";

/**
 * Public form embedded on the suspicious-taker detail page for requesting
 * that a taker be un-flagged. No admin token required — an admin reviews and
 * approves downstream. Kept collapsed by default so the detail page's primary
 * signals (reports, order trend) stay above the fold.
 */
export function RemovalRequestForm({
  binanceUserId,
  displayName,
}: {
  binanceUserId: string;
  displayName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [contact, setContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      setError("Please explain why this flag is mistaken.");
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
        }),
      });
      const json = await r.json();
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
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-border bg-card/40 px-4 py-3 text-[12px] text-muted-foreground">
        <div className="flex items-start gap-2">
          <ShieldOff className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Think this flag is a mistake?{" "}
            <span className="text-foreground">
              Request removal — an admin will review.
            </span>
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
        >
          Request removal
        </Button>
      </div>
    );
  }

  return (
    <Card className="border-border bg-card/60">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          <ShieldOff className="h-3.5 w-3.5" />
          Request removal for {displayName}
        </CardTitle>
        <p className="text-[11px] text-muted-foreground/70">
          Explain why this taker shouldn&apos;t be on the suspicious list. An
          admin reviews every request before anything is un-flagged.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Why is this flag mistaken?</Label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. This is my own account and the flag is based on a misunderstanding. The order referenced in the report was completed successfully — see tx IDs…"
              maxLength={1000}
              rows={4}
              className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Contact (optional)</Label>
            <Input
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="Email, Telegram handle — so the admin can follow up"
              maxLength={200}
            />
            <p className="text-[10px] text-muted-foreground/70">
              Optional. Helps the admin ask for clarification instead of
              rejecting the request outright.
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-[color:var(--color-sell)]/40 bg-[color:var(--color-sell-muted)] px-3 py-2 text-sm text-[color:var(--color-sell)]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {submitted && (
            <div className="flex items-center gap-2 rounded-md border border-[color:var(--color-buy)]/40 bg-[color:var(--color-buy-muted)] px-3 py-2 text-sm text-[color:var(--color-buy)]">
              <CheckCircle2 className="h-4 w-4" />
              Request submitted. An admin will review it.
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Button type="submit" disabled={submitting || submitted}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Submit request
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              disabled={submitting}
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
