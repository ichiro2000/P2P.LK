"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { decodeQrFromFile } from "@/lib/qr-decode-client";
import { formatSLT } from "@/lib/format";
import { AlertTriangle, CheckCircle2, Upload, Loader2, ExternalLink } from "lucide-react";
import type { SuspiciousReport } from "@/lib/db/suspicious";
import type { BinanceProfileRef } from "@/lib/qr";

type Result =
  | { kind: "idle" }
  | { kind: "decoding" }
  | { kind: "checking"; decoded: string }
  | { kind: "clean"; profile: BinanceProfileRef }
  | { kind: "flagged"; profile: BinanceProfileRef; reports: SuspiciousReport[] }
  | { kind: "error"; message: string; decoded?: string };

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
      const r = await fetch(
        `/api/suspicious/check?decoded=${encodeURIComponent(decoded)}`,
        { cache: "no-store" },
      );
      const json = await r.json();
      if (!r.ok) {
        setResult({
          kind: "error",
          message: json.error ?? `HTTP ${r.status}`,
          decoded,
        });
        return;
      }
      if (json.flagged) {
        setResult({ kind: "flagged", profile: json.profile, reports: json.reports });
      } else {
        setResult({ kind: "clean", profile: json.profile });
      }
    } catch (e) {
      setResult({
        kind: "error",
        message: e instanceof Error ? e.message : "Network error.",
      });
    }
  }

  return (
    <Card className="border-border bg-card/60">
      <CardHeader className="pb-3">
        <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Check a QR
        </CardTitle>
        <p className="text-[11px] text-muted-foreground/70">
          Upload a Binance Share-Profile QR to see if the taker has been
          reported by the community.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <FileDrop
          disabled={result.kind === "decoding" || result.kind === "checking"}
          onFile={onFile}
        />

        <ResultView result={result} onReset={() => setResult({ kind: "idle" })} />
      </CardContent>
    </Card>
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
        "relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center transition-colors",
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
      <Upload className="h-5 w-5 text-muted-foreground" />
      <div className="text-sm">
        <span className="font-medium text-foreground">Click to upload</span>
        <span className="text-muted-foreground"> or drag a QR image here</span>
      </div>
      <div className="text-[10px] text-muted-foreground/70">
        PNG or JPEG · decoded locally in your browser
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

function ResultView({
  result,
  onReset,
}: {
  result: Result;
  onReset: () => void;
}) {
  if (result.kind === "idle") return null;

  if (result.kind === "decoding" || result.kind === "checking") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {result.kind === "decoding" ? "Reading QR…" : "Checking registry…"}
      </div>
    );
  }

  if (result.kind === "error") {
    return (
      <div className="space-y-2 rounded-md border border-[color:var(--color-sell)]/40 bg-[color:var(--color-sell-muted)] px-3 py-2 text-sm">
        <div className="flex items-start gap-2 text-[color:var(--color-sell)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="flex-1">{result.message}</p>
        </div>
        {result.decoded && (
          <div className="border-t border-border/40 pt-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Decoded content
            </div>
            <code className="mt-0.5 block break-all font-mono text-[10px] text-muted-foreground">
              {result.decoded}
            </code>
          </div>
        )}
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onReset}>
          Try another
        </Button>
      </div>
    );
  }

  if (result.kind === "clean") {
    return (
      <div className="space-y-2 rounded-md border border-[color:var(--color-buy)]/40 bg-[color:var(--color-buy-muted)] px-3 py-3 text-sm">
        <div className="flex items-center gap-2 text-[color:var(--color-buy)]">
          <CheckCircle2 className="h-4 w-4" />
          <span className="font-semibold">Not in our registry</span>
        </div>
        <p className="text-xs text-muted-foreground">
          No reports found for this taker. Absence isn&apos;t a guarantee —
          still do your usual checks.
        </p>
        <ProfileLine profile={result.profile} />
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onReset}>
          Check another
        </Button>
      </div>
    );
  }

  // flagged
  return (
    <div className="space-y-3 rounded-md border border-[color:var(--color-sell)]/50 bg-[color:var(--color-sell-muted)] px-3 py-3 text-sm">
      <div className="flex items-center gap-2 text-[color:var(--color-sell)]">
        <AlertTriangle className="h-4 w-4" />
        <span className="font-semibold">
          Flagged — {result.reports.length} report
          {result.reports.length === 1 ? "" : "s"}
        </span>
      </div>
      <ProfileLine profile={result.profile} />
      <ul className="space-y-2 border-t border-border/60 pt-2">
        {result.reports.map((r) => (
          <li key={r.id} className="text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="destructive">{r.reason}</Badge>
              <span className="text-muted-foreground">
                {formatSLT(r.ts)} SLT
              </span>
              {r.reporter && (
                <span className="text-muted-foreground">· by {r.reporter}</span>
              )}
            </div>
            {r.notes && (
              <p className="mt-1 text-muted-foreground">{r.notes}</p>
            )}
          </li>
        ))}
      </ul>
      <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onReset}>
        Check another
      </Button>
    </div>
  );
}

function ProfileLine({ profile }: { profile: BinanceProfileRef }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span className="font-mono">advertiserNo: {profile.userId}</span>
      <a
        href={profile.profileUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 underline hover:text-foreground"
      >
        Open on Binance <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}
