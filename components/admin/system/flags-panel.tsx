"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { BANNER_MAX, type Flags } from "@/lib/flags-schema";

type BoolFlag = "signupsOpen" | "alertEmails" | "fxCollector";

const BOOL_FLAGS: { key: BoolFlag; label: string; on: string; off: string }[] = [
  {
    key: "signupsOpen",
    label: "Sign-ups open",
    on: "New merchants can create accounts.",
    off: "Sign-up is refused with a friendly “paused” message.",
  },
  {
    key: "alertEmails",
    label: "Alert emails",
    on: "Fired alerts are emailed (max one email per user per 10 min).",
    off: "Alerts still fire and show in the in-app inbox; no email is sent.",
  },
  {
    key: "fxCollector",
    label: "FX collector",
    on: "The cron collects bank and CBSL rates every 3 hours.",
    off: "The cron skips FX collection. “Collect FX now” still works.",
  },
];

async function patchFlags(body: Partial<Flags>): Promise<Flags> {
  const r = await fetch("/api/admin/flags", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await r.json().catch(() => ({}))) as { flags?: Flags; error?: string };
  if (!r.ok || !json.flags) throw new Error(json.error ?? `Request failed (HTTP ${r.status}).`);
  return json.flags;
}

export function FlagsPanel({ initial }: { initial: Flags }) {
  const router = useRouter();
  const [flags, setFlags] = useState(initial);
  const [banner, setBanner] = useState(initial.banner);
  const [busy, setBusy] = useState<keyof Flags | null>(null);
  const [, startRefresh] = useTransition();

  async function save(body: Partial<Flags>, key: keyof Flags, done: string) {
    setBusy(key);
    const prev = flags;
    setFlags({ ...flags, ...body }); // optimistic
    try {
      const next = await patchFlags(body);
      setFlags(next);
      setBanner(next.banner);
      toast.success(done);
      // The shell (banner) and this page re-read the flags.
      startRefresh(() => router.refresh());
    } catch (err) {
      setFlags(prev);
      toast.error(err instanceof Error ? err.message : "Couldn't save the flag.");
    } finally {
      setBusy(null);
    }
  }

  const bannerDirty = banner.trim() !== flags.banner;

  return (
    <Card className="gap-0 divide-y divide-border py-0">
      {BOOL_FLAGS.map((f) => {
        const on = flags[f.key];
        return (
          <div key={f.key} className="flex items-start justify-between gap-4 px-4 py-3.5">
            <div className="min-w-0 space-y-0.5">
              <Label htmlFor={`flag-${f.key}`} className="text-sm font-medium">
                {f.label}
                {!on && (
                  <span className="ml-1 inline-flex h-5 items-center rounded-full border border-[color:var(--color-warn)]/40 bg-[color:var(--color-warn)]/10 px-2 text-[11px] font-medium text-[color:var(--color-warn)]">
                    Off
                  </span>
                )}
              </Label>
              <p className="text-xs text-pretty text-muted-foreground">{on ? f.on : f.off}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2 pt-0.5">
              {busy === f.key && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />}
              <Switch
                id={`flag-${f.key}`}
                aria-label={f.label}
                checked={on}
                disabled={busy !== null}
                onCheckedChange={(c) => save({ [f.key]: c }, f.key, `${f.label}: ${c ? "on" : "off"}`)}
              />
            </div>
          </div>
        );
      })}
      <form
        className="space-y-2 px-4 py-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (bannerDirty) void save({ banner: banner.trim() }, "banner", banner.trim() ? "Banner updated" : "Banner removed");
        }}
      >
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor="flag-banner" className="text-sm font-medium">
            Site banner
          </Label>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {banner.length}/{BANNER_MAX}
          </span>
        </div>
        <Textarea
          id="flag-banner"
          value={banner}
          maxLength={BANNER_MAX}
          rows={2}
          placeholder="Shown at the top of every page. Leave empty for none."
          onChange={(e) => setBanner(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Plain text. Visitors can dismiss it; changing the text shows it to them again.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" className="h-9 sm:h-8" disabled={busy !== null || !bannerDirty}>
            {busy === "banner" && <Loader2 className="animate-spin" aria-hidden />}
            Save banner
          </Button>
          {flags.banner && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 sm:h-8"
              disabled={busy !== null}
              onClick={() => save({ banner: "" }, "banner", "Banner removed")}
            >
              Remove banner
            </Button>
          )}
        </div>
      </form>
      <p className="px-4 py-2.5 text-[11px] text-muted-foreground">
        Changes are logged in the audit log and reach every server within about a minute.
      </p>
    </Card>
  );
}
