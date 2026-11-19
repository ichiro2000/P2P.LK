"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, FileText, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatSLT } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Callout } from "./parts";

type Status = "pending" | "active" | "rejected" | "retracted";

type MyReport = {
  id: number;
  ts: number;
  userId: string;
  displayName: string | null;
  reason: string;
  status: Status;
  reviewedTs: number | null;
  reviewNote: string | null;
};

const LABEL: Record<Status, string> = {
  pending: "In review",
  active: "Published",
  rejected: "Declined",
  retracted: "Retracted",
};

const TONE: Record<Status, string> = {
  pending: "border-[color:var(--color-warn)]/40 bg-[color:var(--color-warn)]/10 text-[color:var(--color-warn)]",
  active: "border-[color:var(--color-buy)]/40 bg-[color:var(--color-buy)]/10 text-[color:var(--color-buy)]",
  rejected: "border-border text-muted-foreground",
  retracted: "border-border text-muted-foreground",
};

/** The signed-in member's own registry submissions, from GET /api/me/reports.
 *  Bump `refreshKey` to re-fetch (e.g. after a submission). */
export function MyReports({ refreshKey = 0 }: { refreshKey?: number }) {
  const [reports, setReports] = useState<MyReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState<number | null>(null);
  const loading = loadedKey !== refreshKey;

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/me/reports", { cache: "no-store", credentials: "same-origin", signal: ac.signal })
      .then(async (r) => {
        const json = (await r.json().catch(() => ({}))) as { error?: string; reports?: MyReport[] };
        if (!r.ok) setError(json.error ?? `HTTP ${r.status}`);
        else {
          setError(null);
          setReports(json.reports ?? []);
        }
        setLoadedKey(refreshKey);
      })
      .catch((err: unknown) => {
        if ((err as Error)?.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Network error.");
        setLoadedKey(refreshKey);
      });
    return () => ac.abort();
  }, [refreshKey]);

  return (
    <section className="space-y-3" aria-labelledby="my-reports">
      <div className="flex items-center gap-2">
        <h3 id="my-reports" className="text-sm font-semibold">
          My reports
        </h3>
        {loading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Loading" />}
      </div>

      {error && <Callout tone="sell" icon={AlertTriangle} title={error} role="alert" />}

      {reports && reports.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <FileText className="size-4" /> You haven&apos;t reported anyone yet.
        </p>
      )}

      {reports && reports.length > 0 && (
        <Card className="gap-0 divide-y py-0">
          {reports.map((r) => (
            <div key={r.id} className="space-y-1.5 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {r.status === "active" ? (
                    <Link
                      href={`/suspicious/${encodeURIComponent(r.userId)}`}
                      className="block truncate text-sm font-medium underline-offset-2 hover:underline"
                    >
                      {r.displayName || r.userId}
                    </Link>
                  ) : (
                    <div className="truncate text-sm font-medium">{r.displayName || r.userId}</div>
                  )}
                  <div className="truncate font-mono text-xs text-muted-foreground">{r.userId}</div>
                </div>
                <span
                  className={cn(
                    "inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-xs font-medium whitespace-nowrap",
                    TONE[r.status],
                  )}
                >
                  {LABEL[r.status]}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <span className="break-words">{r.reason}</span>
                <span className="font-mono tabular-nums">{formatSLT(r.ts)}</span>
              </div>
              {r.reviewNote && r.status !== "pending" && (
                <p className="rounded-md bg-muted/50 px-2 py-1 text-xs break-words whitespace-pre-wrap text-muted-foreground">
                  <span className="font-medium text-foreground">Moderator note:</span> {r.reviewNote}
                </p>
              )}
            </div>
          ))}
        </Card>
      )}
    </section>
  );
}
