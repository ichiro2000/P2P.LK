import Link from "next/link";
import { ExternalLink, Inbox, Search, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/common/empty";
import { formatSLT } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  REGISTRY_LIST_LIMIT,
  REGISTRY_TABS,
  type RegistryRow,
  type RegistryStatus,
} from "@/lib/db/registry-admin";
import { RegistryActions } from "./registry-actions";

const STATUS_TONE: Record<RegistryStatus, string> = {
  pending: "border-[color:var(--color-warn)]/40 bg-[color:var(--color-warn)]/10 text-[color:var(--color-warn)]",
  active: "border-[color:var(--color-sell)]/40 bg-[color:var(--color-sell)]/10 text-[color:var(--color-sell)]",
  rejected: "border-border text-muted-foreground",
  retracted: "border-border text-muted-foreground",
};

const STATUS_LABEL: Record<RegistryStatus, string> = {
  pending: "Pending",
  active: "Active",
  rejected: "Rejected",
  retracted: "Retracted",
};

const safeUrl = (u: string | null) => (u && /^https:\/\//i.test(u) ? u : null);

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  );
}

function ReportCard({ r }: { r: RegistryRow }) {
  const profile = safeUrl(r.profileUrl);
  const takerLabel = r.displayName ? `${r.displayName} (${r.userId})` : r.userId;
  return (
    <Card className="h-full gap-3 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <div className="truncate font-medium">{r.displayName || "No display name"}</div>
          <div className="font-mono text-xs break-all text-muted-foreground">{r.userId}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={cn(
              "inline-flex h-5 items-center rounded-full border px-2 text-xs font-medium whitespace-nowrap",
              STATUS_TONE[r.status],
            )}
          >
            {STATUS_LABEL[r.status]}
          </span>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">#{r.id}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {profile && (
          <a
            href={profile}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex min-h-8 items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Profile on {r.exchange === "bybit" ? "Bybit" : "Binance"} <ExternalLink className="size-3" />
          </a>
        )}
        {r.otherActive > 0 ? (
          <Link
            href={`/suspicious/${encodeURIComponent(r.userId)}`}
            className="inline-flex min-h-8 items-center gap-1 text-xs font-medium text-[color:var(--color-sell)] underline-offset-2 hover:underline"
          >
            <Users className="size-3.5" />
            {r.otherActive} other active {r.otherActive === 1 ? "report" : "reports"}
          </Link>
        ) : (
          <span className="inline-flex min-h-8 items-center gap-1 text-xs text-muted-foreground">
            <Users className="size-3.5" /> No other active reports
          </span>
        )}
      </div>

      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">Reason</div>
        <p className="text-sm font-medium break-words">{r.reason}</p>
      </div>
      {r.notes && (
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Notes</div>
          <p className="text-sm break-words whitespace-pre-wrap">{r.notes}</p>
        </div>
      )}

      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Meta label="Reporter">{r.reporter || "—"}</Meta>
        <Meta label="Submitted by">
          {r.submitterEmail ? (
            <>
              {r.submitterName || r.submitterMerchant || "—"}
              <a
                href={`mailto:${r.submitterEmail}`}
                className="block text-xs break-all text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                {r.submitterEmail}
              </a>
            </>
          ) : (
            <span className="text-muted-foreground">{r.submittedBy ? "Deleted account" : "Legacy import"}</span>
          )}
        </Meta>
        <Meta label="Submitted">
          <span className="font-mono text-xs tabular-nums">{formatSLT(r.ts)}</span>
        </Meta>
        {r.reviewedTs && r.status !== "pending" && (
          <Meta label="Reviewed">
            <span className="font-mono text-xs tabular-nums">{formatSLT(r.reviewedTs)}</span>
            {r.reviewerEmail && <span className="block text-xs break-all text-muted-foreground">{r.reviewerEmail}</span>}
          </Meta>
        )}
      </dl>

      {r.reviewNote && r.status !== "pending" && (
        <p className="rounded-md bg-muted/50 px-2 py-1 text-xs break-words whitespace-pre-wrap text-muted-foreground">
          <span className="font-medium text-foreground">Review note:</span> {r.reviewNote}
        </p>
      )}

      <RegistryActions
        id={r.id}
        status={r.status}
        takerLabel={takerLabel}
        className="mt-auto grid grid-cols-2 gap-2 border-t pt-3 sm:flex sm:flex-wrap"
      />
    </Card>
  );
}

export function RegistryQueue({
  tab,
  q,
  counts,
  rows,
}: {
  tab: RegistryStatus;
  q: string;
  counts: Record<RegistryStatus, number>;
  rows: RegistryRow[];
}) {
  const href = (t: RegistryStatus) => {
    const p = new URLSearchParams();
    if (t !== "pending") p.set("status", t);
    if (q) p.set("q", q);
    const s = p.toString();
    return `/admin/registry${s ? `?${s}` : ""}`;
  };
  const current = REGISTRY_TABS.find((t) => t.key === tab)!;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <nav aria-label="Report status" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <ul className="inline-flex gap-1 rounded-lg bg-muted p-1">
            {REGISTRY_TABS.map((t) => {
              const active = t.key === tab;
              return (
                <li key={t.key}>
                  <Link
                    href={href(t.key)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm whitespace-nowrap transition-colors sm:h-8",
                      active ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t.label}
                    <span
                      className={cn(
                        "rounded-full px-1.5 font-mono text-xs tabular-nums",
                        t.key === "pending" && counts[t.key] > 0
                          ? "bg-[color:var(--color-warn)]/15 text-[color:var(--color-warn)]"
                          : "bg-foreground/5",
                      )}
                    >
                      {counts[t.key]}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <form action="/admin/registry" method="get" role="search" className="flex w-full gap-2 sm:max-w-md xl:w-80">
          {tab !== "pending" && <input type="hidden" name="status" value={tab} />}
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              name="q"
              type="search"
              defaultValue={q}
              placeholder="Taker id, name, reason, submitter"
              aria-label="Search reports"
              className="h-10 pl-8 sm:h-9"
              maxLength={100}
            />
          </div>
          <Button type="submit" variant="outline" className="h-10 sm:h-9">
            Search
          </Button>
        </form>
      </div>

      {rows.length === 0 ? (
        <Empty
          icon={Inbox}
          title={q ? `No ${current.label.toLowerCase()} reports match “${q}”` : `No ${current.label.toLowerCase()} reports`}
          description={tab === "pending" && !q ? "Nothing waiting for review." : undefined}
        />
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {rows.map((r) => (
              <li key={r.id}>
                <ReportCard r={r} />
              </li>
            ))}
          </ul>
          {rows.length >= REGISTRY_LIST_LIMIT && (
            <p className="text-xs text-muted-foreground">Showing the first {REGISTRY_LIST_LIMIT}. Search to narrow it down.</p>
          )}
        </>
      )}
    </div>
  );
}
