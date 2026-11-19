"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { decodeQrFromFile } from "@/lib/qr-decode-client";
import { AlertTriangle, CheckCircle2, ExternalLink, Flag, Loader2 } from "lucide-react";
import type { SuspiciousReport } from "@/lib/db/suspicious";
import type { BinanceProfileRef } from "@/lib/qr";
import { Callout, ReportItem } from "./parts";
import { FileDrop } from "./file-drop";

type Result =
  | { kind: "idle" }
  | { kind: "decoding" }
  | { kind: "checking"; decoded: string }
  | { kind: "clean"; profile: BinanceProfileRef; decoded: string }
  | {
      kind: "flagged";
      profile: BinanceProfileRef;
      reports: SuspiciousReport[];
      decoded: string;
    }
  | { kind: "error"; message: string; decoded?: string };

const TAP = "h-10 sm:h-9";

export function QrChecker() {
  const [result, setResult] = useState<Result>({ kind: "idle" });

  async function onFile(file: File) {
    setResult({ kind: "decoding" });
    let decoded: string;
    try {
      decoded = await decodeQrFromFile(file);
    } catch (e) {
      setResult({
        kind: "error",
        message: e instanceof Error ? e.message : "Couldn't decode the QR.",
      });
      return;
    }

    setResult({ kind: "checking", decoded });
    try {
      const r = await fetch(`/api/suspicious/check?decoded=${encodeURIComponent(decoded)}`, {
        cache: "no-store",
      });
      const json = (await r.json()) as {
        error?: string;
        flagged?: boolean;
        profile: BinanceProfileRef;
        reports: SuspiciousReport[];
      };
      if (!r.ok) {
        setResult({ kind: "error", message: json.error ?? `HTTP ${r.status}`, decoded });
        return;
      }
      if (json.flagged) {
        setResult({ kind: "flagged", profile: json.profile, reports: json.reports, decoded });
      } else {
        setResult({ kind: "clean", profile: json.profile, decoded });
      }
    } catch (e) {
      setResult({
        kind: "error",
        message: e instanceof Error ? e.message : "Network error.",
      });
    }
  }

  const busy = result.kind === "decoding" || result.kind === "checking";

  return (
    <Card className="gap-4 py-4">
      <CardContent className="space-y-4 px-4">
        {result.kind === "idle" || busy ? (
          <FileDrop disabled={busy} onFile={onFile} />
        ) : null}
        <div aria-live="polite">
          <ResultView result={result} onReset={() => setResult({ kind: "idle" })} />
        </div>
      </CardContent>
    </Card>
  );
}

function ResultView({ result, onReset }: { result: Result; onReset: () => void }) {
  if (result.kind === "idle") return null;

  if (result.kind === "decoding" || result.kind === "checking") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {result.kind === "decoding" ? "Reading QR…" : "Checking the registry…"}
      </div>
    );
  }

  const again = (
    <Button variant="ghost" className={TAP} onClick={onReset}>
      Check another
    </Button>
  );

  if (result.kind === "error") {
    return (
      <div className="space-y-3">
        <Callout tone="sell" icon={AlertTriangle} title="Couldn't check this QR" role="alert">
          <p>{result.message}</p>
          {result.decoded && (
            <div className="mt-2 border-t border-border pt-2">
              <div className="text-xs font-medium text-foreground">Decoded content</div>
              <code className="mt-0.5 block font-mono text-xs break-all">{result.decoded}</code>
            </div>
          )}
        </Callout>
        {again}
      </div>
    );
  }

  if (result.kind === "clean") {
    return (
      <div className="space-y-3">
        <Callout tone="buy" icon={CheckCircle2} title="Not in the registry" role="status">
          No reports found for this taker. That isn&apos;t a guarantee, so still do your usual checks. If
          you&apos;ve had a bad experience with them, flag them for the next merchant.
        </Callout>
        <ProfileLine profile={result.profile} />
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Link
            href={`/suspicious/new?decoded=${encodeURIComponent(result.decoded)}`}
            className={buttonVariants({ variant: "outline", className: TAP })}
          >
            <Flag /> Flag this taker
          </Link>
          {again}
        </div>
      </div>
    );
  }

  // flagged
  const n = result.reports.length;
  return (
    <div className="space-y-3">
      <Callout tone="sell" icon={AlertTriangle} title={`Flagged · ${n} report${n === 1 ? "" : "s"}`} role="alert">
        Other merchants have reported this taker. Read the reports before you trade.
      </Callout>
      <ProfileLine profile={result.profile} />
      <ul className="divide-y divide-border rounded-lg border px-3.5 py-3">
        {result.reports.map((r) => (
          <ReportItem key={r.id} report={r} />
        ))}
      </ul>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Link
          href={`/suspicious/${encodeURIComponent(result.profile.userId)}`}
          className={buttonVariants({ className: TAP })}
        >
          Open details
        </Link>
        <Link
          href={`/suspicious/new?decoded=${encodeURIComponent(result.decoded)}`}
          className={buttonVariants({ variant: "outline", className: TAP })}
        >
          <Flag /> Add another report
        </Link>
        {again}
      </div>
    </div>
  );
}

function ProfileLine({ profile }: { profile: BinanceProfileRef }) {
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
      <span className="font-mono break-all">advertiserNo {profile.userId}</span>
      <a
        href={profile.profileUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
      >
        Open on Binance <ExternalLink className="size-3" />
      </a>
    </div>
  );
}
