"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw, Undo2, X } from "lucide-react";
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

type Status = "pending" | "active" | "rejected" | "retracted";
type Action = "publish" | "reject" | "retract" | "restore";

const META: Record<
  Action,
  { label: string; title: string; description: string; note: "optional" | "required"; done: string; placeholder: string }
> = {
  publish: {
    label: "Publish",
    title: "Publish this report?",
    description: "It goes into the public registry straight away.",
    note: "optional",
    done: "Published",
    placeholder: "Anything worth recording",
  },
  reject: {
    label: "Reject",
    title: "Reject this report?",
    description: "It never goes public. The submitter sees your note in their reports list.",
    note: "required",
    done: "Rejected",
    placeholder: "Why — the submitter sees this",
  },
  retract: {
    label: "Retract",
    title: "Retract this report?",
    description: "It's removed from the public registry. You can restore it later.",
    note: "required",
    done: "Retracted",
    placeholder: "Why it's being taken down",
  },
  restore: {
    label: "Restore",
    title: "Restore this report?",
    description: "It goes back into the public registry as an active report.",
    note: "optional",
    done: "Restored",
    placeholder: "Anything worth recording",
  },
};

const ICON: Record<Action, typeof CheckCircle2> = {
  publish: CheckCircle2,
  reject: X,
  retract: Undo2,
  restore: RotateCcw,
};

const ACTIONS_FOR: Record<Status, Action[]> = {
  pending: ["publish", "reject"],
  active: ["retract"],
  rejected: ["restore"],
  retracted: ["restore"],
};

const ERROR_BOX =
  "flex items-start gap-2 rounded-lg border border-[color:var(--color-sell)]/40 bg-[color:var(--color-sell)]/5 px-3 py-2 text-sm text-[color:var(--color-sell)]";

export function RegistryActions({
  id,
  status,
  takerLabel,
  className,
}: {
  id: number;
  status: Status;
  takerLabel: string;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Action | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const actions = ACTIONS_FOR[status];
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
      const r = await fetch(`/api/admin/registry/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: open, note: note.trim() || null }),
      });
      const json = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setError(json.error ?? `Request failed (HTTP ${r.status}).`);
        if (r.status === 409 || r.status === 404) startRefresh(() => router.refresh());
        return;
      }
      toast.success(`${META[open].done} · report #${id}`);
      setOpen(null);
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
        const destructive = a === "reject" || a === "retract";
        return (
          <Button
            key={a}
            type="button"
            size="lg"
            variant={destructive ? "destructive" : "default"}
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
                  Report #{id} · <span className="break-all text-foreground">{takerLabel}</span>
                  <br />
                  {meta.description}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-1.5">
                <Label htmlFor={`reg-note-${id}`}>Note {meta.note === "required" ? "(required)" : "(optional)"}</Label>
                <Textarea
                  id={`reg-note-${id}`}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={1000}
                  rows={3}
                  placeholder={meta.placeholder}
                  disabled={busy}
                  autoFocus
                />
              </div>

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
                  variant={open === "reject" || open === "retract" ? "destructive" : "default"}
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
