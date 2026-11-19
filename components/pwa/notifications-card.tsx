"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { formatDistanceToNow } from "date-fns";
import { BellOff, BellRing, Laptop, Loader2, Send, Smartphone, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { openIosInstallHelp } from "@/components/pwa/install";
import {
  disablePush,
  enablePush,
  getPushServerSnapshot,
  getPushSnapshot,
  subscribePush,
  syncPush,
  type PushStatus,
} from "@/lib/push/client";
import { formatSLT } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * "Notifications on this device" (enable / disable / test) and "Your
 * devices" (every browser with push on, last delivery, remove). Used on
 * /alerts and /account. Members only — the page gates it.
 */

type Device = {
  id: string;
  label: string;
  createdAt: number;
  lastSeenAt: number;
  lastSuccessAt: number | null;
  failureCount: number;
  lastError: string | null;
  lastErrorAt: number | null;
};

const STATUS_TEXT: Record<PushStatus, { label: string; text: string; tone: "buy" | "warn" | "sell" | "muted" }> = {
  loading: { label: "Checking…", text: "Checking this browser.", tone: "muted" },
  on: {
    label: "On",
    text: "Alerts arrive on this device even when P2P.LK is closed.",
    tone: "buy",
  },
  off: {
    label: "Off",
    text: "Turn on to get a notification on this device the moment an alert fires.",
    tone: "muted",
  },
  denied: {
    label: "Blocked",
    text: "Notifications are blocked for P2P.LK in this browser's site settings. Allow them there, then reload this page.",
    tone: "sell",
  },
  "ios-install": {
    label: "Needs Home Screen",
    text: "On iPhone and iPad, notifications only work in the Home Screen app (iOS 16.4 or later). Add P2P.LK to your Home Screen, open it from there, then turn notifications on.",
    tone: "warn",
  },
  unsupported: {
    label: "Not supported",
    text: "This browser can't show web notifications. Use Chrome, Edge, Firefox or Samsung Internet, or the Home Screen app on iPhone.",
    tone: "muted",
  },
  unconfigured: {
    label: "Unavailable",
    text: "Notifications aren't set up on the server yet. Email alerts still work.",
    tone: "muted",
  },
};

const DOT = {
  buy: "bg-[color:var(--color-buy)]",
  warn: "bg-[color:var(--color-warn)]",
  sell: "bg-[color:var(--color-sell)]",
  muted: "bg-muted-foreground/50",
} as const;

const ago = (sec: number) => formatDistanceToNow(new Date(sec * 1000), { addSuffix: true });

export function NotificationsCard({ className }: { className?: string }) {
  const push = useSyncExternalStore(subscribePush, getPushSnapshot, getPushServerSnapshot);
  const [busy, setBusy] = useState<null | "enable" | "disable" | "test" | string>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [max, setMax] = useState(10);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/me/push", { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as { devices: Device[]; max: number };
      setDevices(j.devices);
      setMax(j.max);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    // The shell's PushSync also runs this; the shared in-flight promise
    // makes the second call free. The list reloads once the sync settles.
    void syncPush().then(load);
  }, [load]);

  async function enable() {
    setBusy("enable");
    const r = await enablePush();
    setBusy(null);
    if (r.ok) toast.success("Notifications are on for this device");
    else toast.error(r.error);
    void load();
  }

  async function disable() {
    setBusy("disable");
    await disablePush();
    setBusy(null);
    toast.success("Notifications are off for this device");
    void load();
  }

  async function test(id?: string) {
    setBusy(id ? `test:${id}` : "test");
    try {
      const r = await fetch("/api/me/push/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(id ? { id } : {}),
      });
      const j = (await r.json().catch(() => ({}))) as {
        results?: { ok: boolean; status: number; action: string }[];
        error?: string;
      };
      if (!r.ok || !j.results) throw new Error(j.error ?? `Request failed (HTTP ${r.status}).`);
      const ok = j.results.filter((x) => x.ok).length;
      const failed = j.results.length - ok;
      if (failed === 0) toast.success(ok === 1 ? "Test sent. It should appear in a few seconds." : `Test sent to ${ok} devices.`);
      else if (ok > 0) toast.warning(`Sent to ${ok}, failed on ${failed} device${failed === 1 ? "" : "s"}. See the list below.`);
      else toast.error(`The push service refused the test (HTTP ${j.results[0]?.status || "network"}). See the list below.`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
      void load();
    }
  }

  async function remove(d: Device) {
    setBusy(`rm:${d.id}`);
    try {
      if (d.id === push.deviceId) {
        await disablePush();
      } else {
        const r = await fetch("/api/me/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: d.id }),
        });
        if (!r.ok) throw new Error(`Couldn't remove the device (HTTP ${r.status}).`);
      }
      toast.success(`Removed ${d.label}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
      void load();
    }
  }

  const s = STATUS_TEXT[push.status];
  const on = push.status === "on";

  return (
    <div className={cn("space-y-4", className)}>
      <Card className="gap-3 px-4 py-4" data-testid="push-card">
        <div className="flex items-start gap-3">
          {on ? (
            <BellRing className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          ) : (
            <BellOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium">Notifications on this device</h3>
              <Badge variant="outline" className="gap-1.5" data-testid="push-status">
                <span className={cn("size-1.5 rounded-full", DOT[s.tone])} aria-hidden />
                {s.label}
              </Badge>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{s.text}</p>
            {push.error && push.status !== "denied" && (
              <p className="text-xs text-[color:var(--color-sell)]" role="status">
                {push.error}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {(push.status === "off" || push.status === "loading") && (
            <Button className="h-10 sm:h-9" onClick={enable} disabled={busy !== null || push.status === "loading"}>
              {busy === "enable" ? <Loader2 className="animate-spin" aria-hidden /> : <BellRing aria-hidden />}
              Enable notifications
            </Button>
          )}
          {push.status === "ios-install" && (
            <Button className="h-10 sm:h-9" onClick={openIosInstallHelp}>
              <Smartphone aria-hidden />
              How to add to Home Screen
            </Button>
          )}
          {on && (
            <>
              <Button className="h-10 sm:h-9" onClick={() => test(push.deviceId ?? undefined)} disabled={busy !== null}>
                {busy?.startsWith("test") ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
                Send test
              </Button>
              <Button variant="outline" className="h-10 sm:h-9" onClick={disable} disabled={busy !== null}>
                {busy === "disable" ? <Loader2 className="animate-spin" aria-hidden /> : <BellOff aria-hidden />}
                Turn off here
              </Button>
            </>
          )}
        </div>
      </Card>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium">Your devices</h3>
          {devices && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {devices.length} of {max}
            </span>
          )}
        </div>
        {devices === null ? (
          loadError ? (
            <p className="text-sm text-muted-foreground">Couldn&apos;t load your devices. Reload to try again.</p>
          ) : (
            <Skeleton className="h-16 w-full rounded-xl" />
          )
        ) : devices.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No devices yet. Turn on notifications on each phone or computer you want alerts on.
          </p>
        ) : (
          <Card className="gap-0 py-0">
            <ul className="divide-y divide-border" data-testid="push-devices">
              {devices.map((d) => {
                const mobile = /iPhone|iPad|Android/.test(d.label);
                const Icon = mobile ? Smartphone : Laptop;
                const failing = d.failureCount > 0;
                return (
                  <li key={d.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium">{d.label}</span>
                          {d.id === push.deviceId && <Badge variant="outline">This device</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {d.lastSuccessAt ? (
                            <span title={formatSLT(new Date(d.lastSuccessAt * 1000))}>
                              Last delivered {ago(d.lastSuccessAt)}
                            </span>
                          ) : (
                            "Nothing delivered yet"
                          )}
                          <span aria-hidden> · </span>
                          last opened {ago(d.lastSeenAt)}
                        </div>
                        {failing && (
                          <div className="text-xs text-[color:var(--color-warn)]">
                            {d.failureCount} failed send{d.failureCount === 1 ? "" : "s"} in a row
                            {d.lastError ? ` (${d.lastError})` : ""}. We keep retrying.
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 sm:shrink-0">
                      <Button
                        variant="outline"
                        className="h-10 flex-1 px-3 sm:h-8 sm:flex-none"
                        disabled={busy !== null}
                        onClick={() => test(d.id)}
                        aria-label={`Send a test notification to ${d.label}`}
                      >
                        {busy === `test:${d.id}` ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
                        Test
                      </Button>
                      <Button
                        variant="outline"
                        className="h-10 flex-1 px-3 sm:h-8 sm:flex-none"
                        disabled={busy !== null}
                        onClick={() => remove(d)}
                        aria-label={`Remove ${d.label}`}
                      >
                        {busy === `rm:${d.id}` ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
                        Remove
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
