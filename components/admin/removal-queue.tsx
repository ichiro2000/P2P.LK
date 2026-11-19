"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, CheckCircle2, ExternalLink, Inbox, Loader2, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty } from "@/components/common/empty";
import { formatSLT } from "@/lib/format";

type RemovalStatus = "pending" | "approved" | "rejected";

type RemovalRequest = {
  id: number;
  ts: number;
  userId: string;
  exchange: "binance" | "bybit";
  reason: string;
  reporterContact: string | null;
  status: RemovalStatus;
  reviewedTs: number | null;
  reviewNote: string | null;
};

type FilterStatus = RemovalStatus | "all";

const FIELD = "h-10 sm:h-9";
const ERROR_BOX =
  "flex items-start gap-2 rounded-lg border border-[color:var(--color-sell)]/40 bg-[color:var(--color-sell)]/5 px-3 py-2 text-sm text-[color:var(--color-sell)]";

/**
 * Admin-only review queue, authorized by the admin session cookie. Approving
 * also retracts every active report for the taker on the server, so the
 * registry drops them immediately. Decisions are written to the audit log.
 */
export function RemovalQueue() {
  const [filter, setFilter] = useState<FilterStatus>("pending");
  const [requests, setRequests] = useState<RemovalRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumping the nonce re-fetches the current view (after a decision).
  const [nonce, setNonce] = useState(0);
  const viewKey = `${filter}|${nonce}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loading = loadedKey !== viewKey;
  const load = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    const ac = new AbortController();
    // Same-origin: the admin session cookie authorizes the request.
    fetch(`/api/suspicious/removal-requests?status=${filter}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: ac.signal,
    })
      .then(async (r) => {
        const json = (await r.json().catch(() => ({}))) as { error?: string; requests?: RemovalRequest[] };
        if (!r.ok) {
          setError(json.error ?? `HTTP ${r.status}`);
          setRequests(null);
        } else {
          setError(null);
          setRequests(json.requests ?? []);
        }
        setLoadedKey(viewKey);
      })
      .catch((err: unknown) => {
        if ((err as Error)?.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Network error.");
        setLoadedKey(viewKey);
      });
    return () => ac.abort();
  }, [filter, viewKey]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterStatus)}>
          <TabsList className="h-10 w-full sm:h-9 sm:w-fit" aria-label="Request status">
            {(["pending", "approved", "rejected", "all"] as const).map((s) => (
              <TabsTrigger key={s} value={s} className="px-2 text-xs capitalize sm:px-3 sm:text-sm">
                {s}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {error && (
        <div role="alert" className={ERROR_BOX}>
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && !requests && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      )}

      {requests && requests.length === 0 && !loading && (
        <Empty
          icon={Inbox}
          title={`No ${filter === "all" ? "" : `${filter} `}requests`}
          description={filter === "pending" ? "Nothing waiting for review." : undefined}
        />
      )}

      {requests && requests.length > 0 && (
        <ul className="grid gap-3 lg:grid-cols-2">
          {requests.map((req) => (
            <li key={req.id}>
              <RemovalRow req={req} onChanged={load} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RemovalRow({ req, onChanged }: { req: RemovalRequest; onChanged: () => void }) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState<null | "approved" | "rejected">(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function decide(decision: "approved" | "rejected") {
    setSubmitting(decision);
    setError(null);
    try {
      const r = await fetch(`/api/suspicious/removal-requests/${req.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ decision, reviewNote: note.trim() || null }),
      });
      const json = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setError(json.error ?? `HTTP ${r.status}`);
        if (r.status === 409) onChanged();
        return;
      }
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSubmitting(null);
    }
  }

  const pending = req.status === "pending";

  return (
    <Card className="h-full gap-3 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <Link
            href={`/suspicious/${encodeURIComponent(req.userId)}`}
            className="block truncate font-mono text-sm font-medium underline-offset-2 hover:underline"
            title={req.userId}
          >
            {req.userId}
          </Link>
          <div className="text-xs text-muted-foreground">
            Sent <span className="font-mono tabular-nums">{formatSLT(req.ts)}</span>
            {req.reviewedTs && (
              <>
                {" · decided "}
                <span className="font-mono tabular-nums">{formatSLT(req.reviewedTs)}</span>
              </>
            )}
          </div>
        </div>
        <StatusBadge status={req.status} />
      </div>

      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">Reason</div>
        <p className="text-sm break-words whitespace-pre-wrap">{req.reason}</p>
      </div>

      {req.reporterContact && (
        <div className="text-xs text-muted-foreground">
          Contact <span className="font-mono break-all text-foreground">{req.reporterContact}</span>
        </div>
      )}

      {req.reviewNote && !pending && (
        <div className="space-y-1 rounded-lg bg-muted/50 px-3 py-2">
          <div className="text-xs text-muted-foreground">Admin note</div>
          <p className="text-sm break-words whitespace-pre-wrap">{req.reviewNote}</p>
        </div>
      )}

      <a
        href={`https://p2p.binance.com/en/advertiserDetail?advertiserNo=${encodeURIComponent(req.userId)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        Open on Binance <ExternalLink className="size-3" />
      </a>

      {pending && (
        <div className="mt-auto space-y-3 border-t pt-3">
          <div className="space-y-1.5">
            <Label htmlFor={`note-${req.id}`}>Review note (optional)</Label>
            <Input
              id={`note-${req.id}`}
              className={FIELD}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why you approved or rejected it"
              maxLength={1000}
              disabled={submitting !== null}
            />
          </div>

          {error && (
            <div role="alert" className={ERROR_BOX}>
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Button type="button" className={FIELD} onClick={() => setConfirmOpen(true)} disabled={submitting !== null}>
              {submitting === "approved" ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
              Approve
            </Button>
            <Button
              type="button"
              variant="outline"
              className={FIELD}
              onClick={() => decide("rejected")}
              disabled={submitting !== null}
            >
              {submitting === "rejected" ? <Loader2 className="animate-spin" /> : <X />}
              Reject
            </Button>
          </div>

          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Approve and retract reports?</DialogTitle>
                <DialogDescription>
                  This retracts every active report for{" "}
                  <span className="font-mono break-all text-foreground">{req.userId}</span> and removes the taker from
                  the registry.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose render={<Button variant="outline" className={FIELD} />}>Cancel</DialogClose>
                <Button
                  className={FIELD}
                  onClick={() => {
                    setConfirmOpen(false);
                    void decide("approved");
                  }}
                >
                  Approve and retract
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </Card>
  );
}

function StatusBadge({ status }: { status: RemovalStatus }) {
  if (status === "pending") {
    return (
      <Badge variant="outline" className="shrink-0 border-[color:var(--color-warn)]/40 text-[color:var(--color-warn)]">
        Pending
      </Badge>
    );
  }
  if (status === "approved") {
    return (
      <Badge variant="outline" className="shrink-0 border-[color:var(--color-buy)]/40 text-[color:var(--color-buy)]">
        <Check /> Approved
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="shrink-0 text-muted-foreground">
      Rejected
    </Badge>
  );
}
