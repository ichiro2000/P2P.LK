import Link from "next/link";
import { ExternalLink, Inbox, MessageCircle, Search, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Empty } from "@/components/common/empty";
import { formatSLT } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { UserStatus } from "@/lib/db/schema";
import { LIST_LIMIT, MEMBER_TABS, type AuditRow, type MemberRow, type MemberTab } from "./data";
import { MemberActions } from "./member-actions";

const STATUS_LABEL: Record<UserStatus, string> = {
  pending_email: "Unverified",
  pending_review: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  suspended: "Suspended",
};

const STATUS_TONE: Record<UserStatus, string> = {
  pending_email: "border-border text-muted-foreground",
  pending_review: "border-[color:var(--color-warn)]/40 bg-[color:var(--color-warn)]/10 text-[color:var(--color-warn)]",
  approved: "border-[color:var(--color-buy)]/40 bg-[color:var(--color-buy)]/10 text-[color:var(--color-buy)]",
  rejected: "border-[color:var(--color-sell)]/40 bg-[color:var(--color-sell)]/10 text-[color:var(--color-sell)]",
  suspended: "border-[color:var(--color-sell)]/40 bg-[color:var(--color-sell)]/10 text-[color:var(--color-sell)]",
};

function StatusBadge({ status, role }: { status: UserStatus; role: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={cn("inline-flex h-5 items-center rounded-full border px-2 text-xs font-medium whitespace-nowrap", STATUS_TONE[status])}>
        {STATUS_LABEL[status]}
      </span>
      {role === "admin" && (
        <span className="inline-flex h-5 items-center gap-1 rounded-full border border-border px-2 text-xs font-medium whitespace-nowrap">
          <ShieldCheck className="size-3" /> Admin
        </span>
      )}
    </span>
  );
}

const waLink = (n: string) => {
  const digits = n.replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : null;
};
const safeUrl = (u: string | null) => (u && /^https:\/\//i.test(u) ? u : null);

function Contacts({ m }: { m: MemberRow }) {
  const wa = waLink(m.whatsapp);
  const binance = safeUrl(m.binanceUrl);
  const bybit = safeUrl(m.bybitUrl);
  const link =
    "inline-flex min-h-8 items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {wa ? (
        <a href={wa} target="_blank" rel="noopener noreferrer" className={cn(link, "font-mono tabular-nums")}>
          <MessageCircle className="size-3.5" />
          {m.whatsapp}
        </a>
      ) : (
        <span className="text-xs text-muted-foreground">No WhatsApp</span>
      )}
      {binance && (
        <a href={binance} target="_blank" rel="noopener noreferrer nofollow" className={link}>
          Binance <ExternalLink className="size-3" />
        </a>
      )}
      {bybit && (
        <a href={bybit} target="_blank" rel="noopener noreferrer nofollow" className={link}>
          Bybit <ExternalLink className="size-3" />
        </a>
      )}
    </div>
  );
}

function ReviewNote({ m }: { m: MemberRow }) {
  if (!m.reviewNote) return null;
  return (
    <p className="rounded-md bg-muted/50 px-2 py-1 text-xs break-words whitespace-pre-wrap text-muted-foreground">
      <span className="font-medium text-foreground">Note:</span> {m.reviewNote}
    </p>
  );
}

export function MemberQueue({
  tab,
  q,
  counts,
  members,
  admins,
  viewerId,
}: {
  tab: MemberTab;
  q: string;
  counts: Record<MemberTab, number>;
  members: MemberRow[];
  admins: number;
  viewerId: string;
}) {
  const href = (t: MemberTab) => {
    const p = new URLSearchParams();
    if (t !== "pending_review") p.set("status", t);
    if (q) p.set("q", q);
    const s = p.toString();
    return `/admin/members${s ? `?${s}` : ""}`;
  };
  const current = MEMBER_TABS.find((t) => t.key === tab)!;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <nav aria-label="Member status" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <ul className="inline-flex gap-1 rounded-lg bg-muted p-1">
            {MEMBER_TABS.map((t) => {
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
                        t.key === "pending_review" && counts[t.key] > 0
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

        <form action="/admin/members" method="get" role="search" className="flex w-full gap-2 sm:max-w-md xl:w-80">
          {tab !== "pending_review" && <input type="hidden" name="status" value={tab} />}
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              name="q"
              type="search"
              defaultValue={q}
              placeholder="Name, merchant or email"
              aria-label="Search members"
              className="h-10 pl-8 sm:h-9"
              maxLength={100}
            />
          </div>
          <Button type="submit" variant="outline" className="h-10 sm:h-9">
            Search
          </Button>
        </form>
      </div>

      {members.length === 0 ? (
        <Empty
          icon={Inbox}
          title={q ? `No ${current.label.toLowerCase()} members match “${q}”` : `No ${current.label.toLowerCase()} members`}
          description={tab === "pending_review" && !q ? "Nothing waiting for review." : undefined}
        />
      ) : (
        <>
          {/* Phones / tablets: cards */}
          <ul className="grid gap-3 sm:grid-cols-2 lg:hidden">
            {members.map((m) => (
              <li key={m.id}>
                <Card className="h-full gap-3 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{m.name}</div>
                      <div className="truncate text-sm text-muted-foreground">{m.merchantName || "—"}</div>
                    </div>
                    <StatusBadge status={m.status} role={m.role} />
                  </div>
                  <div className="space-y-1">
                    <a href={`mailto:${m.email}`} className="block text-sm break-all underline-offset-2 hover:underline">
                      {m.email}
                    </a>
                    <Contacts m={m} />
                    <div className="text-xs text-muted-foreground">
                      Joined <span className="font-mono tabular-nums">{formatSLT(new Date(m.createdAt))}</span>
                    </div>
                  </div>
                  <ReviewNote m={m} />
                  <MemberActions member={m} viewerId={viewerId} admins={admins} className="mt-auto grid grid-cols-2 gap-2 border-t pt-3" />
                </Card>
              </li>
            ))}
          </ul>

          {/* Desktop: table */}
          <Card className="hidden py-0 lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Member</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pr-4 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.id} className="align-top">
                    <TableCell className="max-w-64 min-w-44 pl-4 whitespace-normal">
                      <div className="font-medium">{m.name}</div>
                      <div className="text-sm text-muted-foreground">{m.merchantName || "—"}</div>
                      <a href={`mailto:${m.email}`} className="text-xs break-all text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                        {m.email}
                      </a>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <Contacts m={m} />
                    </TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">{formatSLT(new Date(m.createdAt))}</TableCell>
                    <TableCell className="max-w-56 space-y-1 whitespace-normal">
                      <StatusBadge status={m.status} role={m.role} />
                      <ReviewNote m={m} />
                    </TableCell>
                    <TableCell className="pr-4">
                      <MemberActions member={m} viewerId={viewerId} admins={admins} className="flex flex-wrap justify-end gap-2" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          {members.length >= LIST_LIMIT && (
            <p className="text-xs text-muted-foreground">Showing the first {LIST_LIMIT}. Search to narrow it down.</p>
          )}
        </>
      )}
    </div>
  );
}

const ACTION_LABEL: Record<string, string> = {
  "member.approve": "approved",
  "member.reject": "rejected",
  "member.suspend": "suspended",
  "member.unsuspend": "unsuspended",
  "member.make_admin": "made admin",
  "member.remove_admin": "removed admin from",
};

export function RecentAdminActions({ rows }: { rows: AuditRow[] }) {
  return (
    <section className="space-y-3" aria-labelledby="recent-admin-actions">
      <h3 id="recent-admin-actions" className="text-sm font-semibold">
        Recent admin actions
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing yet.</p>
      ) : (
        <Card className="gap-0 divide-y py-0">
          {rows.map((r) => {
            const d = r.detail ?? {};
            const target = typeof d.email === "string" ? d.email : r.targetId;
            const note = typeof d.note === "string" ? d.note : null;
            return (
              <div key={r.id} className="flex flex-col gap-0.5 px-4 py-2.5 text-sm sm:flex-row sm:items-baseline sm:gap-3">
                <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{formatSLT(r.ts)}</span>
                <span className="min-w-0 break-words">
                  <span className="text-muted-foreground">{r.actorEmail ?? "system"}</span>{" "}
                  <span className="font-medium">{ACTION_LABEL[r.action] ?? r.action}</span>
                  {target && <> <span className="break-all">{target}</span></>}
                  {note && <span className="text-muted-foreground"> — “{note}”</span>}
                </span>
              </div>
            );
          })}
        </Card>
      )}
    </section>
  );
}
