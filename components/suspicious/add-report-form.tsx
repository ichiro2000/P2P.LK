"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, Clock, Loader2, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { decodeQrFromFile } from "@/lib/qr-decode-client";
import { parseBinanceProfile, type BinanceProfileRef } from "@/lib/qr";
import { cn } from "@/lib/utils";
import { Callout, Field } from "./parts";
import { FileDrop } from "./file-drop";

const REASON_PRESETS = [
  "3rd Party Scam",
  "4th Party Scam",
  "Crypto Remarks on Payments",
  "Chargeback / payment reversal",
  "Fake payment receipt",
  "Escrow abuse / frivolous appeal",
  "Multi-account / ban evasion",
  "Threats / harassment",
  "Other (see notes)",
] as const;

const FIELD = "h-10 sm:h-9";

export function AddReportForm({
  isAdmin,
  merchantName,
  onSubmitted,
}: {
  /** Admins publish immediately; members' reports wait for review. */
  isAdmin: boolean;
  /** Default for "Reported by" (the server uses it when left blank). */
  merchantName: string;
  /** Called after a member's report is accepted (e.g. refresh "My reports"). */
  onSubmitted?: () => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [decoded, setDecoded] = useState<string>("");
  const [profile, setProfile] = useState<BinanceProfileRef | null>(null);
  const [decodeError, setDecodeError] = useState<string | null>(null);
  const [decoding, setDecoding] = useState(false);
  // Manually pasted profile URL, used when the QR is a short-link
  // (binance.com/qr/XXX) our server can't follow past Binance's WAF. When set
  // it replaces the decoded QR as the submitted `decoded` payload.
  const [manualUrl, setManualUrl] = useState("");

  const [displayName, setDisplayName] = useState("");
  // True while the Binance nickname lookup is in flight; the name field is
  // disabled so manual typing doesn't race the auto-fill.
  const [displayNameLoading, setDisplayNameLoading] = useState(false);
  // True when `displayName` came from the lookup (shows a hint, and lets a
  // later lookup replace it without stomping on user input).
  const [displayNameAuto, setDisplayNameAuto] = useState(false);
  const [reason, setReason] = useState<string>(REASON_PRESETS[0]);
  const [customReason, setCustomReason] = useState("");
  const [notes, setNotes] = useState("");
  const [reporter, setReporter] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<null | "review" | "published">(null);

  const resolvedReason = reason === "Other (see notes)" ? customReason.trim() : reason;

  // A real advertiserNo looks like `s<hex>` (16+ chars, no slashes or dots).
  // An opaque URL-shaped userId means a short-link we couldn't follow, so we
  // show a paste-URL fallback.
  const isShortLink = profile != null && !/^[sS]?[A-Za-z0-9]{16,}$/.test(profile.userId);

  // Arriving from the QR checker's "Flag this taker" button puts the decoded
  // QR in `?decoded=…`. Treat it like a fresh upload: parse for an instant
  // preview during render, then run the server lookup once per distinct seed.
  const seeded = searchParams.get("decoded");
  const [seenSeed, setSeenSeed] = useState<string | null>(null);
  if (seeded && seeded !== seenSeed) {
    setSeenSeed(seeded);
    if (seeded !== decoded) {
      setDecoded(seeded);
      const parsed = parseBinanceProfile(seeded);
      if (parsed) setProfile(parsed);
      setDisplayNameLoading(true);
    }
  }
  useEffect(() => {
    if (seenSeed) void fetchLookup(seenSeed);
    // `fetchLookup` only touches state setters after its first await.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seenSeed]);

  async function handleFile(file: File) {
    setDecoding(true);
    setDecodeError(null);
    setProfile(null);
    setDecoded("");
    try {
      const raw = await decodeQrFromFile(file);
      setDecoded(raw);
      // Sync parse is only a fast preview; the server lookup follows
      // short-link redirects and fetches the nickname.
      const parsed = parseBinanceProfile(raw);
      if (parsed) setProfile(parsed);
      void runServerLookup(raw);
    } catch (e) {
      setDecodeError(e instanceof Error ? e.message : "QR decode failed.");
    } finally {
      setDecoding(false);
    }
  }

  function runServerLookup(rawDecoded: string) {
    setDisplayNameLoading(true);
    void fetchLookup(rawDecoded);
  }

  async function fetchLookup(rawDecoded: string) {
    try {
      const r = await fetch(`/api/suspicious/lookup?decoded=${encodeURIComponent(rawDecoded)}`, {
        cache: "no-store",
      });
      if (!r.ok) {
        if (r.status === 422 && !profile) {
          setDecodeError(
            "QR decoded, but we couldn't find a Binance advertiserNo in it. Check that it's a Binance P2P profile QR.",
          );
        }
        return;
      }
      const json = (await r.json()) as {
        displayName: string | null;
        profile: BinanceProfileRef;
        source?: "snapshot" | "binance" | "none";
      };
      // The server's profile is post-redirect, the one that gets stored.
      setProfile(json.profile);
      const found = json.displayName?.trim();
      if (found) {
        setDisplayName((cur) => {
          if (cur && cur.trim() && !displayNameAuto) return cur;
          return found;
        });
        setDisplayNameAuto(true);
      }
    } catch {
      // Silent — manual entry still works.
    } finally {
      setDisplayNameLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    if (!resolvedReason) {
      setSubmitError("Pick a reason, or describe it if you chose Other.");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const r = await fetch("/api/suspicious", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          // Prefer the pasted profile URL: the QR may be a short-link.
          decoded: manualUrl.trim() || decoded,
          displayName: displayName || null,
          reason: resolvedReason,
          notes: notes || null,
          reporter: reporter || null,
        }),
      });
      const json = (await r.json().catch(() => ({}))) as {
        error?: string;
        pending?: boolean;
        report?: { id: number; userId: string };
      };
      if (!r.ok) {
        setSubmitError(json.error ?? `HTTP ${r.status}`);
        return;
      }
      if (json.pending) {
        setSubmitted("review");
        onSubmitted?.();
        return;
      }
      // Published: open the taker's public page.
      setSubmitted("published");
      const target = json.report?.userId ? `/suspicious/${encodeURIComponent(json.report.userId)}` : "/suspicious";
      router.push(target);
      router.refresh();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setDecoded("");
    setProfile(null);
    setDecodeError(null);
    setManualUrl("");
    setDisplayName("");
    setDisplayNameAuto(false);
    setReason(REASON_PRESETS[0]);
    setCustomReason("");
    setNotes("");
    setReporter("");
    setSubmitError(null);
    setSubmitted(null);
    // Drop a ?decoded= seed so it doesn't re-fill the form.
    if (searchParams.get("decoded")) router.replace("/suspicious/new");
  }

  if (submitted === "review") {
    return (
      <Card className="gap-4 py-5">
        <CardContent className="space-y-4 px-4">
          <Callout tone="buy" icon={CheckCircle2} title="Submitted for review" role="status">
            Thanks. An admin will check the report before it goes into the public registry. You can follow its status
            under My reports below.
          </Callout>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="ghost" className={FIELD} onClick={() => router.push("/suspicious")}>
              Back to registry
            </Button>
            <Button type="button" className={FIELD} onClick={resetForm}>
              Report another taker
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Card className="gap-4 py-4">
        <CardHeader className="px-4">
          <CardTitle className="text-sm font-medium">1. Taker</CardTitle>
          <CardDescription className="text-xs">
            Upload their Binance Share-Profile QR. It is decoded in your browser.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 px-4">
          <FileDrop disabled={decoding} onFile={handleFile} compact />
          <div aria-live="polite" className="space-y-3 empty:hidden">
            {decoding && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Reading QR…
              </div>
            )}
            {decodeError && (
              <Callout tone="sell" icon={AlertTriangle} title={decodeError} role="alert">
                {decoded && (
                  <div className="space-y-1">
                    <div className="font-medium text-foreground">Decoded content</div>
                    <code className="block font-mono break-all">{decoded}</code>
                    <p>
                      If this looks like a Binance link but doesn&apos;t match, send it to the maintainer so the
                      parser can be extended.
                    </p>
                  </div>
                )}
              </Callout>
            )}
            {profile && !isShortLink && (
              <Callout tone="buy" icon={CheckCircle2} title="QR decoded">
                <div className="font-mono break-all text-foreground">advertiserNo {profile.userId}</div>
                <a
                  href={profile.profileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate font-mono underline underline-offset-2"
                >
                  {profile.profileUrl}
                </a>
              </Callout>
            )}
            {isShortLink && (
              <Callout tone="warn" icon={AlertTriangle} title="This QR is a short-link: one more step">
                <p>
                  Binance protects these redirects with a challenge, so we can&apos;t follow it.{" "}
                  <a
                    href={decoded}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    Open the link
                  </a>
                  , then copy the profile page URL from the address bar and paste it below.
                </p>
                <Input
                  className={cn("mt-2", FIELD)}
                  value={manualUrl}
                  aria-label="Profile page URL"
                  inputMode="url"
                  onChange={(e) => {
                    setManualUrl(e.target.value);
                    if (e.target.value.trim()) void runServerLookup(e.target.value.trim());
                  }}
                  placeholder="https://c2c.binance.com/en/advertiserDetail?advertiserNo=…"
                />
              </Callout>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Display name"
              htmlFor="rep-name"
              hint={
                displayNameAuto && !displayNameLoading ? (
                  <span className="inline-flex items-center gap-1 text-[color:var(--color-buy)]">
                    <CheckCircle2 className="size-3.5" /> Filled in from Binance. Edit it if the nickname changed.
                  </span>
                ) : profile && !displayName && !displayNameLoading ? (
                  "We haven't seen this taker on the LKR book. Enter their nickname."
                ) : null
              }
            >
              <div className="relative">
                <Input
                  id="rep-name"
                  className={FIELD}
                  value={displayName}
                  onChange={(e) => {
                    setDisplayName(e.target.value);
                    setDisplayNameAuto(false);
                  }}
                  placeholder={displayNameLoading ? "Looking up on Binance…" : "Filled in from the QR"}
                  maxLength={120}
                  disabled={displayNameLoading}
                />
                {displayNameLoading && (
                  <Loader2 className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                )}
              </div>
            </Field>
            <Field label="Reported by (optional)" htmlFor="rep-by" hint={merchantName ? `Leave blank to use ${merchantName}.` : undefined}>
              <Input
                id="rep-by"
                className={FIELD}
                value={reporter}
                onChange={(e) => setReporter(e.target.value)}
                placeholder={merchantName || "Your name or handle"}
                maxLength={120}
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card className="gap-4 py-4">
        <CardHeader className="px-4">
          <CardTitle className="text-sm font-medium">2. What happened</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 px-4">
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">Reason</legend>
            <div role="radiogroup" aria-label="Reason" className="flex flex-wrap gap-2">
              {REASON_PRESETS.map((r) => {
                const on = reason === r;
                return (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    key={r}
                    onClick={() => setReason(r)}
                    className={cn(
                      "min-h-10 rounded-lg border px-3 py-1.5 text-left text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8 sm:text-xs",
                      on
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {r}
                  </button>
                );
              })}
            </div>
            {reason === "Other (see notes)" && (
              <Input
                className={cn("mt-2", FIELD)}
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder="Describe the reason"
                aria-label="Custom reason"
                maxLength={120}
              />
            )}
          </fieldset>

          <Field label="Notes and evidence (optional)" htmlFor="rep-notes">
            <Textarea
              id="rep-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Context, timestamps, order IDs: anything the next merchant should know."
              maxLength={1000}
              rows={4}
              className="min-h-24"
            />
          </Field>
        </CardContent>
      </Card>

      <Card className="gap-4 py-4">
        <CardHeader className="px-4">
          <CardTitle className="text-sm font-medium">3. {isAdmin ? "Publish" : "Submit"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 px-4">
          {isAdmin ? (
            <Callout tone="buy" icon={ShieldCheck} title="Publishes immediately">
              You&apos;re an admin, so this report goes into the public registry as soon as you add it.
            </Callout>
          ) : (
            <Callout tone="warn" icon={Clock} title="An admin reviews reports before they go public">
              You&apos;ll see it under My reports as pending until it&apos;s published or declined.
            </Callout>
          )}

          {submitError && (
            <Callout tone="sell" icon={AlertTriangle} title={submitError} role="alert" />
          )}
          {submitted === "published" && (
            <Callout tone="buy" icon={CheckCircle2} title="Report published. Opening it…" role="status" />
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="ghost" className={FIELD} onClick={() => router.push("/suspicious")}>
              Cancel
            </Button>
            <Button type="submit" className={FIELD} disabled={!profile || submitting || submitted !== null}>
              {submitting && <Loader2 className="animate-spin" />}
              {isAdmin ? "Publish report" : "Submit for review"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
