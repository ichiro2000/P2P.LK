"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { decodeQrFromFile } from "@/lib/qr-decode-client";
import { parseBinanceProfile, type BinanceProfileRef } from "@/lib/qr";
import { AlertTriangle, CheckCircle2, Loader2, Upload } from "lucide-react";

const REASON_PRESETS = [
  "4th Party Scam",
  "Chargeback / payment reversal",
  "Fake payment receipt",
  "Escrow abuse / frivolous appeal",
  "Multi-account / ban evasion",
  "Threats / harassment",
  "Other (see notes)",
] as const;

const TOKEN_KEY = "p2plk_admin_token";

export function AddReportForm() {
  const router = useRouter();

  const [decoded, setDecoded] = useState<string>("");
  const [profile, setProfile] = useState<BinanceProfileRef | null>(null);
  const [decodeError, setDecodeError] = useState<string | null>(null);
  const [decoding, setDecoding] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [reason, setReason] = useState<string>(REASON_PRESETS[0]);
  const [customReason, setCustomReason] = useState("");
  const [notes, setNotes] = useState("");
  const [reporter, setReporter] = useState("");
  const [token, setToken] = useState<string>(() =>
    typeof window !== "undefined"
      ? sessionStorage.getItem(TOKEN_KEY) ?? ""
      : "",
  );

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const resolvedReason =
    reason === "Other (see notes)" ? customReason.trim() : reason;

  async function handleFile(file: File) {
    setDecoding(true);
    setDecodeError(null);
    setProfile(null);
    setDecoded("");
    try {
      const raw = await decodeQrFromFile(file);
      setDecoded(raw);
      const parsed = parseBinanceProfile(raw);
      if (!parsed) {
        setDecodeError(
          "QR decoded, but we couldn't find a Binance advertiserNo in it. Double-check it's a Binance P2P profile QR.",
        );
      } else {
        setProfile(parsed);
      }
    } catch (e) {
      setDecodeError(e instanceof Error ? e.message : "QR decode failed.");
    } finally {
      setDecoding(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    if (!resolvedReason) {
      setSubmitError("Please pick a reason (or describe it if you chose Other).");
      return;
    }
    if (!token.trim()) {
      setSubmitError("Admin token is required.");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const r = await fetch("/api/suspicious", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-token": token.trim(),
        },
        body: JSON.stringify({
          decoded,
          displayName: displayName || null,
          reason: resolvedReason,
          notes: notes || null,
          reporter: reporter || null,
        }),
      });
      const json = await r.json();
      if (!r.ok) {
        setSubmitError(json.error ?? `HTTP ${r.status}`);
        return;
      }
      sessionStorage.setItem(TOKEN_KEY, token.trim());
      setSubmitted(true);
      setTimeout(() => {
        router.push("/suspicious");
        router.refresh();
      }, 800);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="border-border bg-card/60">
      <CardHeader className="pb-3">
        <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Add a report
        </CardTitle>
        <p className="text-[11px] text-muted-foreground/70">
          Upload the taker&apos;s Binance Share-Profile QR. We decode it in
          your browser, extract the advertiserNo, and submit the report with
          your reason.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>QR image</Label>
            <FileDrop disabled={decoding} onFile={handleFile} />
            {decoding && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Reading QR…
              </div>
            )}
            {decodeError && (
              <div className="flex items-start gap-2 rounded-md border border-[color:var(--color-sell)]/40 bg-[color:var(--color-sell-muted)] px-3 py-2 text-xs text-[color:var(--color-sell)]">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{decodeError}</span>
              </div>
            )}
            {profile && (
              <div className="rounded-md border border-[color:var(--color-buy)]/40 bg-[color:var(--color-buy-muted)] px-3 py-2 text-xs">
                <div className="flex items-center gap-2 text-[color:var(--color-buy)]">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span className="font-semibold">QR decoded</span>
                </div>
                <div className="mt-1 font-mono text-muted-foreground">
                  advertiserNo: {profile.userId}
                </div>
                <a
                  href={profile.profileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-0.5 inline-block truncate font-mono text-[10px] text-muted-foreground underline"
                >
                  {profile.profileUrl}
                </a>
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Display name (optional)">
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. nivedha Kannan"
                maxLength={120}
              />
            </Field>
            <Field label="Reported by (optional)">
              <Input
                value={reporter}
                onChange={(e) => setReporter(e.target.value)}
                placeholder="Your name or handle"
                maxLength={120}
              />
            </Field>
          </div>

          <Field label="Reason">
            <div className="flex flex-wrap gap-1.5">
              {REASON_PRESETS.map((r) => (
                <button
                  type="button"
                  key={r}
                  onClick={() => setReason(r)}
                  className={[
                    "rounded-md border px-2 py-1 text-xs transition-colors",
                    reason === r
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-transparent text-muted-foreground hover:text-foreground",
                  ].join(" ")}
                >
                  {r}
                </button>
              ))}
            </div>
            {reason === "Other (see notes)" && (
              <Input
                className="mt-2"
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="Describe the reason"
                maxLength={120}
              />
            )}
          </Field>

          <Field label="Notes / evidence (optional)">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Context, timestamps, transaction IDs, anything the next merchant should know."
              maxLength={1000}
              rows={4}
              className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            />
          </Field>

          <Field label="Admin token">
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Required to publish"
              autoComplete="off"
            />
            <p className="mt-1 text-[10px] text-muted-foreground/70">
              Shared community secret. Saved in this browser tab only.
            </p>
          </Field>

          {submitError && (
            <div className="flex items-start gap-2 rounded-md border border-[color:var(--color-sell)]/40 bg-[color:var(--color-sell-muted)] px-3 py-2 text-sm text-[color:var(--color-sell)]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          {submitted && (
            <div className="flex items-center gap-2 rounded-md border border-[color:var(--color-buy)]/40 bg-[color:var(--color-buy-muted)] px-3 py-2 text-sm text-[color:var(--color-buy)]">
              <CheckCircle2 className="h-4 w-4" />
              Report added. Redirecting…
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Button
              type="submit"
              disabled={!profile || submitting || submitted}
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Add report
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.push("/suspicious")}
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function FileDrop({
  disabled,
  onFile,
}: {
  disabled: boolean;
  onFile: (f: File) => void;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <label
      className={[
        "relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-5 text-center transition-colors",
        dragging
          ? "border-primary bg-primary/5"
          : "border-border bg-muted/20 hover:bg-muted/30",
        disabled && "pointer-events-none opacity-60",
      ]
        .filter(Boolean)
        .join(" ")}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
    >
      <Upload className="h-4 w-4 text-muted-foreground" />
      <div className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Click to upload</span>
        {" or drag a QR image"}
      </div>
      <input
        type="file"
        accept="image/*"
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        disabled={disabled}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.currentTarget.value = "";
        }}
      />
    </label>
  );
}
