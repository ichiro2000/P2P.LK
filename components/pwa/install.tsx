"use client";

import { useSyncExternalStore } from "react";
import { Download, Share, SquarePlus, Smartphone, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  dismissInstallHint,
  getInstallServerSnapshot,
  getInstallSnapshot,
  promptInstall,
  subscribeInstall,
} from "@/lib/pwa/install-store";
import { cn } from "@/lib/utils";

/* ── iOS instructions dialog (one host, opened from anywhere) ─────────── */

let iosOpen = false;
const iosListeners = new Set<() => void>();
function setIosOpen(v: boolean) {
  iosOpen = v;
  for (const l of iosListeners) l();
}
function subscribeIos(l: () => void) {
  iosListeners.add(l);
  return () => iosListeners.delete(l);
}

export function openIosInstallHelp() {
  setIosOpen(true);
}

export function useInstall() {
  return useSyncExternalStore(subscribeInstall, getInstallSnapshot, getInstallServerSnapshot);
}

/** "Install app": Chrome's prompt, or the iOS instructions. */
export async function runInstall(snapshot: ReturnType<typeof getInstallSnapshot>) {
  if (snapshot.canPrompt) {
    const outcome = await promptInstall();
    if (outcome === "accepted") toast.success("Installing P2P.LK…");
    return;
  }
  if (snapshot.iosManual) openIosInstallHelp();
}

/** Mounted once (root layout, via PwaRegister). */
export function IosInstallDialogHost() {
  const open = useSyncExternalStore(subscribeIos, () => iosOpen, () => false);
  return (
    <Dialog open={open} onOpenChange={(v) => setIosOpen(v)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add P2P.LK to your Home Screen</DialogTitle>
          <DialogDescription>
            It opens full screen like an app. On iPhone and iPad, alert notifications only work from the Home Screen
            app (iOS 16.4 or later).
          </DialogDescription>
        </DialogHeader>
        <ol className="space-y-3 text-sm">
          <li className="flex gap-3">
            <Step n={1} />
            <span className="min-w-0">
              In Safari, tap <Share className="inline size-4 align-text-bottom" aria-label="Share" />{" "}
              <span className="font-medium">Share</span> (in the toolbar, or under ••• on iOS 26).
            </span>
          </li>
          <li className="flex gap-3">
            <Step n={2} />
            <span className="min-w-0">
              Scroll and tap <SquarePlus className="inline size-4 align-text-bottom" aria-hidden />{" "}
              <span className="font-medium">Add to Home Screen</span>, then <span className="font-medium">Add</span>.
            </span>
          </li>
          <li className="flex gap-3">
            <Step n={3} />
            <span className="min-w-0">
              Open <span className="font-medium">P2P.LK</span> from your Home Screen, go to Alerts and turn on
              notifications.
            </span>
          </li>
        </ol>
        <Button variant="outline" className="h-10" onClick={() => setIosOpen(false)}>
          Got it
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span
      aria-hidden
      className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs font-semibold"
    >
      {n}
    </span>
  );
}

/** Sidebar footer hint. Quiet, one line, dismissible (remembered 60 days);
 *  only when the app can actually be installed and isn't already. */
export function InstallHint({ onAction, className }: { onAction?: () => void; className?: string }) {
  const s = useInstall();
  if (s.dismissed || !(s.canPrompt || s.iosManual)) return null;
  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-lg border border-sidebar-border p-1 pl-2.5 group-data-[collapsible=icon]:hidden",
        className,
      )}
    >
      {s.iosManual ? (
        <Smartphone className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      ) : (
        <Download className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <button
        type="button"
        onClick={() => {
          onAction?.();
          void runInstall(s);
        }}
        className="min-h-8 flex-1 truncate rounded-md px-1 text-left text-xs font-medium text-sidebar-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        {s.iosManual ? "Add to Home Screen" : "Install the app"}
      </button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-8 shrink-0 text-muted-foreground"
        onClick={dismissInstallHint}
        aria-label="Hide the install suggestion"
      >
        <X />
      </Button>
    </div>
  );
}
