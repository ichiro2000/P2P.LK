"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Eraser, Landmark, Loader2, XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Action = "collect_fx" | "retention";

const ACTIONS: { key: Action; label: string; icon: typeof Landmark; help: string }[] = [
  {
    key: "collect_fx",
    label: "Collect FX now",
    icon: Landmark,
    help: "Fetches every FX source once (about a minute; same-host sources are spaced 11 s apart).",
  },
  {
    key: "retention",
    label: "Run retention now",
    icon: Eraser,
    help: "Deletes raw data past its retention window, as the nightly job does.",
  },
];

type Result =
  | { ok: true; text: string; failed?: { source: string; error: string | null }[] }
  | { ok: false; text: string };

function describe(action: Action, json: Record<string, unknown>): Result {
  const r = (json.result ?? {}) as Record<string, unknown>;
  const secs = `${((Number(json.durationMs) || 0) / 1000).toFixed(1)} s`;
  if (action === "collect_fx") {
    const failed = (r.failed as { source: string; error: string | null }[] | undefined) ?? [];
    return {
      ok: Boolean(json.ok),
      text: `${r.ok}/${r.sources} sources OK · ${Number(r.rows ?? 0).toLocaleString("en-US")} rates · ${secs}`,
      ...(failed.length ? { failed } : {}),
    } as Result;
  }
  return json.ok
    ? { ok: true, text: `Deleted ${Number(r.deleted ?? 0).toLocaleString("en-US")} rows · ${secs}` }
    : { ok: false, text: `Failed: ${String(r.error ?? "unknown error")}` };
}

export function ActionsPanel() {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [results, setResults] = useState<Partial<Record<Action, Result>>>({});
  const [, startRefresh] = useTransition();

  async function run(action: Action) {
    setBusy(action);
    setResults((r) => ({ ...r, [action]: undefined }));
    let res: Result;
    try {
      const r = await fetch("/api/admin/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      res = r.ok ? describe(action, json) : { ok: false, text: String(json.error ?? `HTTP ${r.status}`) };
      if (r.ok) startRefresh(() => router.refresh());
    } catch (err) {
      res = { ok: false, text: err instanceof Error ? err.message : "Network error." };
    }
    setResults((r) => ({ ...r, [action]: res }));
    setBusy(null);
  }

  return (
    <Card className="gap-0 divide-y divide-border py-0">
      {ACTIONS.map((a) => {
        const res = results[a.key];
        return (
          <div key={a.key} className="space-y-2.5 px-4 py-3.5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="min-w-0 text-xs text-pretty text-muted-foreground">{a.help}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-10 shrink-0 sm:h-8"
                disabled={busy !== null}
                onClick={() => run(a.key)}
              >
                {busy === a.key ? <Loader2 className="animate-spin" aria-hidden /> : <a.icon aria-hidden />}
                {busy === a.key ? "Running…" : a.label}
              </Button>
            </div>
            <div aria-live="polite">
              {res && (
                <div
                  className={cn(
                    "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
                    res.ok
                      ? "border-[color:var(--color-buy)]/40 bg-[color:var(--color-buy)]/5"
                      : "border-[color:var(--color-sell)]/40 bg-[color:var(--color-sell)]/5 text-[color:var(--color-sell)]",
                  )}
                >
                  {res.ok ? (
                    <CheckCircle2 className="mt-px size-3.5 shrink-0 text-[color:var(--color-buy)]" aria-hidden />
                  ) : (
                    <XCircle className="mt-px size-3.5 shrink-0" aria-hidden />
                  )}
                  <div className="min-w-0 space-y-1">
                    <p className="font-mono tabular-nums">{res.text}</p>
                    {"failed" in res &&
                      res.failed?.map((f) => (
                        <p key={f.source} className="break-words text-[color:var(--color-sell)]">
                          {f.source}: {f.error}
                        </p>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </Card>
  );
}
