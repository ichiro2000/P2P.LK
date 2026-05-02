"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Lock,
  X,
} from "lucide-react";
import { formatSLT } from "@/lib/format";

const TOKEN_KEY = "p2plk_admin_token";

type RemovalStatus = "pending" | "approved" | "rejected";

type RemovalRequest = {
  id: number;
  ts: number;
  binanceUserId: string;
  reason: string;
  reporterContact: string | null;
  status: RemovalStatus;
  reviewedTs: number | null;
  reviewNote: string | null;
};

type FilterStatus = RemovalStatus | "all";

/**
 * Admin-only review queue. Token is entered once per browser tab and
 * kept in sessionStorage — same pattern as the add-report form. On approve
 * the server also retracts every active report for the taker (done in
 * `decideRemovalRequest`), so the registry drops them immediately.
 */
export function RemovalQueue() {
  const [token, setToken] = useState<string>(() =>
    typeof window !== "undefined"
      ? sessionStorage.getItem(TOKEN_KEY) ?? ""
      : "",
  );
  const [tokenDraft, setTokenDraft] = useState(token);

  const [filter, setFilter] = useState<FilterStatus>("pending");
  const [requests, setRequests] = useState<RemovalRequest[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/suspicious/removal-requests?status=${filter}`,
        { headers: { "x-admin-token": token }, cache: "no-store" },
      );
      const json = await r.json();
      if (!r.ok) {
        setError(json.error ?? `HTTP ${r.status}`);
        setRequests(null);
        return;
      }
      setRequests(json.requests as RemovalRequest[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }, [token, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingCount = useMemo(
    () =>
      requests?.filter((r) => r.status === "pending").length ??
      (filter === "pending" ? requests?.length ?? 0 : 0),
    [requests, filter],
  );

  if (!token) {
    return (
      <Card className="border-border bg-card/60">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <Lock className="h-3.5 w-3.5" />
            Admin token required
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              const v = tokenDraft.trim();
              if (!v) return;
              sessionStorage.setItem(TOKEN_KEY, v);
              setToken(v);
            }}
          >
            <div className="flex-1 space-y-1.5">
              <Label>Admin token</Label>
              <Input
                type="password"
                value={tokenDraft}
                onChange={(e) => setTokenDraft(e.target.value)}
                placeholder="Shared community secret"
                autoComplete="off"
              />
              <p className="text-[10px] text-muted-foreground/70">
                Saved in this browser tab only. Same token as the one used to
                add reports.
              </p>
            </div>
            <Button type="submit" disabled={!tokenDraft.trim()}>
              Unlock
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {(["pending", "approved", "rejected", "all"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              className={[
                "rounded-md border px-2.5 py-1 text-xs capitalize transition-colors",
                filter === s
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-transparent text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {s}
              {s === "pending" && pendingCount > 0 && filter !== "pending" && (
                <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[color:var(--color-sell)]/20 px-1 text-[10px] font-semibold text-[color:var(--color-sell)]">
                  {pendingCount}
                </span>
              )}
            </button>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            sessionStorage.removeItem(TOKEN_KEY);
            setToken("");
            setTokenDraft("");
            setRequests(null);
          }}
        >
          Lock
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-[color:var(--color-sell)]/40 bg-[color:var(--color-sell-muted)] px-3 py-2 text-sm text-[color:var(--color-sell)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && !requests && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      )}

      {requests && requests.length === 0 && !loading && (
        <div className="rounded-lg border border-dashed border-border bg-card/40 px-4 py-10 text-center text-sm text-muted-foreground">
          No {filter === "all" ? "" : filter} requests.
        </div>
      )}

      {requests && requests.length > 0 && (
        <div className="space-y-3">
          {requests.map((req) => (
            <RemovalRow
              key={req.id}
              req={req}
              token={token}
              onChanged={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RemovalRow({
  req,
  token,
  onChanged,
}: {
  req: RemovalRequest;
  token: string;
  onChanged: () => void;
}) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] =
    useState<null | "approved" | "rejected">(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "approved" | "rejected") {
    if (
      decision === "approved" &&
      !confirm(
        `Approve this request? It will retract every active report for ${req.binanceUserId} from the suspicious list.`,
      )
    ) {
      return;
    }
    setSubmitting(decision);
    setError(null);
    try {
      const r = await fetch(
        `/api/suspicious/removal-requests/${req.id}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-admin-token": token,
          },
          body: JSON.stringify({
            decision,
            reviewNote: note.trim() || null,
          }),
        },
      );
      const json = await r.json();
      if (!r.ok) {
        setError(json.error ?? `HTTP ${r.status}`);
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
    <Card className="border-border bg-card/60">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/suspicious/${encodeURIComponent(req.binanceUserId)}`}
                className="truncate font-mono text-sm text-primary hover:underline"
                title={req.binanceUserId}
              >
                {req.binanceUserId}
              </Link>
              <StatusBadge status={req.status} />
              <span className="text-[11px] text-muted-foreground">
                submitted {formatSLT(req.ts)} SLT
              </span>
              {req.reviewedTs && (
                <span className="text-[11px] text-muted-foreground">
                  · decided {formatSLT(req.reviewedTs)} SLT
                </span>
              )}
            </div>
            {req.reporterContact && (
              <div className="text-[11px] text-muted-foreground">
                contact:{" "}
                <span className="font-mono text-foreground">
                  {req.reporterContact}
                </span>
              </div>
            )}
          </div>
          <a
            href={`https://www.bybit.com/fiat/trade/otc/profile/${encodeURIComponent(req.binanceUserId)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card/50 px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
          >
            <ExternalLink className="h-3 w-3" />
            Bybit
          </a>
        </div>

        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Reason
          </div>
          <p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">
            {req.reason}
          </p>
        </div>

        {req.reviewNote && !pending && (
          <div className="rounded-md border border-border/60 bg-card/40 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Admin note
            </div>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">
              {req.reviewNote}
            </p>
          </div>
        )}

        {pending && (
          <>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Review note (optional)
              </Label>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Reason for approving or rejecting — visible in the audit trail"
                maxLength={1000}
                disabled={submitting !== null}
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-[color:var(--color-sell)]/40 bg-[color:var(--color-sell-muted)] px-3 py-2 text-xs text-[color:var(--color-sell)]">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => decide("approved")}
                disabled={submitting !== null}
                className="bg-[color:var(--color-buy)] text-white hover:bg-[color:var(--color-buy)]/90"
              >
                {submitting === "approved" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
                Approve + retract
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => decide("rejected")}
                disabled={submitting !== null}
              >
                {submitting === "rejected" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <X className="h-3.5 w-3.5" />
                )}
                Reject
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: RemovalStatus }) {
  if (status === "pending") {
    return (
      <Badge
        variant="outline"
        className="border-[color:var(--color-warn)]/40 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-warn)]"
      >
        Pending
      </Badge>
    );
  }
  if (status === "approved") {
    return (
      <Badge
        variant="outline"
        className="border-[color:var(--color-buy)]/40 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-buy)]"
      >
        <Check className="mr-0.5 h-3 w-3" />
        Approved
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-muted text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
    >
      Rejected
    </Badge>
  );
}
