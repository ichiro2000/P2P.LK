"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Ban, CheckCircle2, Loader2, RotateCcw, ShieldCheck, ShieldOff, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { MemberRow } from "./data";

type Action = "approve" | "reject" | "suspend" | "unsuspend" | "make_admin" | "remove_admin";

const META: Record<
  Action,
  { label: string; title: string; description: string; note: "none" | "optional" | "required"; done: string }
> = {
  approve: {
    label: "Approve",
    title: "Approve this member?",
    description: "They get full member access and an email saying they're approved.",
    note: "optional",
    done: "Approved — email sent",
  },
  reject: {
    label: "Reject",
    title: "Reject this member?",
    description: "They keep public access only. Your note is included in the email they receive.",
    note: "required",
    done: "Rejected — email sent",
  },
  suspend: {
    label: "Suspend",
    title: "Suspend this member?",
    description: "They're signed out on every device right away and lose member access until unsuspended.",
    note: "required",
    done: "Suspended — sessions revoked",
  },
  unsuspend: {
    label: "Unsuspend",
    title: "Restore this member?",
    description: "Their status goes back to approved. They'll need to sign in again.",
    note: "optional",
    done: "Unsuspended",
  },
  make_admin: {
    label: "Make admin",
    title: "Give admin rights?",
    description: "Admins can approve, reject and suspend members and see every admin page.",
    note: "none",
    done: "Admin rights granted",
  },
  remove_admin: {
    label: "Remove admin",
    title: "Remove admin rights?",
    description: "They stay an approved member but lose access to the admin pages.",
    note: "none",
    done: "Admin rights removed",
  },
};

const ICON: Record<Action, typeof CheckCircle2> = {
  approve: CheckCircle2,
  reject: X,
  suspend: Ban,
  unsuspend: RotateCcw,
  make_admin: ShieldCheck,
  remove_admin: ShieldOff,
};

const ERROR_BOX =
  "flex items-start gap-2 rounded-lg border border-[color:var(--color-sell)]/40 bg-[color:var(--color-sell)]/5 px-3 py-2 text-sm text-[color:var(--color-sell)]";

/** Which actions make sense for this member, for this admin. */
function actionsFor(m: MemberRow, viewerId: string, admins: number): Action[] {
  const self = m.id === viewerId;
  switch (m.status) {
    case "pending_review":
      return ["approve", "reject"];
    case "rejected":
      return ["approve"];
    case "suspended":
      return ["unsuspend"];
    case "approved":
      if (m.role === "admin") return !self && admins > 1 ? ["remove_admin"] : [];
      return ["suspend", "make_admin"];
    default:
      return [];
  }
}

export function MemberActions({
  member,
  viewerId,
  admins,
  className,
}: {
  member: MemberRow;
  viewerId: string;
  admins: number;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Action | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const actions = actionsFor(member, viewerId, admins);

  if (actions.length === 0) {
    const why =
      member.status === "pending_email"
        ? "Waiting for email verification"
        : member.id === viewerId
          ? "This is you"
          : member.role === "admin"
            ? "Only admin"
            : null;
    return why ? <span className="text-xs text-muted-foreground">{why}</span> : null;
  }

  const meta = open ? META[open] : null;
  const noteMissing = meta?.note === "required" && !note.trim();

  function start(a: Action) {
    setNote("");
    setError(null);
    setOpen(a);
  }

  async function submit() {
    if (!open || busy || noteMissing) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/members/${encodeURIComponent(member.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(META[open].note === "none" ? { action: open } : { action: open, note: note.trim() }),
      });
      const json = (await r.json().catch(() => ({}))) as { error?: string; emailed?: boolean | null };
      if (!r.ok) {
        setError(json.error ?? `Request failed (HTTP ${r.status}).`);
        if (r.status === 409) startRefresh(() => router.refresh());
        return;
      }
      const done = META[open].done;
      setOpen(null);
      if (json.emailed === false) toast.warning(`${done.split(" — ")[0]}, but the email couldn't be sent.`);
      else toast.success(`${done} · ${member.name}`);
      startRefresh(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className ?? "flex flex-wrap gap-2"}>
      {actions.map((a) => {
        const Icon = ICON[a];
        const primary = a === "approve" || a === "unsuspend";
        return (
          <Button
            key={a}
            type="button"
            size="lg"
            variant={primary ? "default" : a === "reject" || a === "suspend" ? "destructive" : "outline"}
            className="h-10 sm:h-8"
            disabled={busy || refreshing}
            onClick={() => start(a)}
          >
            <Icon />
            {META[a].label}
          </Button>
        );
      })}

      <Dialog open={open !== null} onOpenChange={(o) => !o && !busy && setOpen(null)}>
        <DialogContent>
          {meta && open && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <DialogHeader>
                <DialogTitle>{meta.title}</DialogTitle>
                <DialogDescription>
                  <span className="font-medium text-foreground">{member.name}</span>
                  {member.merchantName && <> · {member.merchantName}</>} · <span className="break-all">{member.email}</span>
                  <br />
                  {meta.description}
                </DialogDescription>
              </DialogHeader>

              {meta.note !== "none" && (
                <div className="space-y-1.5">
                  <Label htmlFor={`note-${member.id}`}>
                    Note {meta.note === "required" ? "(required)" : "(optional)"}
                  </Label>
                  <Textarea
                    id={`note-${member.id}`}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={1000}
                    rows={3}
                    placeholder={
                      open === "reject"
                        ? "Why — the member sees this in their email"
                        : open === "suspend"
                          ? "Reason for suspension (kept in the audit log)"
                          : "Anything worth recording"
                    }
                    disabled={busy}
                    autoFocus
                  />
                </div>
              )}

              {error && (
                <div role="alert" className={ERROR_BOX}>
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <DialogFooter>
                <DialogClose render={<Button type="button" variant="outline" className="h-10 sm:h-8" disabled={busy} />}>
                  Cancel
                </DialogClose>
                <Button
                  type="submit"
                  className="h-10 sm:h-8"
                  variant={open === "reject" || open === "suspend" || open === "remove_admin" ? "destructive" : "default"}
                  disabled={busy || noteMissing}
                >
                  {busy && <Loader2 className="animate-spin" />}
                  {meta.label}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
