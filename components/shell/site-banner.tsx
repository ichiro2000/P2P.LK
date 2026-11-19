"use client";

import { useSyncExternalStore } from "react";
import { Info, X } from "lucide-react";

/**
 * Site-wide banner (feature flag `banner`, set on /admin/system). Dismissal
 * is remembered per banner text in localStorage, so a new message shows
 * again. Storage can be blocked (private mode), so a memory copy backs it.
 */

const KEY = "p2plk:banner-dismissed";
const EVENT = "p2plk:banner-dismissed";
let memory: string | null = null;

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

function readDismissed(): string | null {
  try {
    return window.localStorage.getItem(KEY) ?? memory;
  } catch {
    return memory;
  }
}

function dismiss(text: string) {
  memory = text;
  try {
    window.localStorage.setItem(KEY, text);
  } catch {
    // Blocked storage: the memory copy hides it for this page view.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function SiteBanner({ text }: { text: string }) {
  // Server render: not dismissed (most visitors haven't), so no layout shift.
  const dismissed = useSyncExternalStore(subscribe, readDismissed, () => null);
  if (!text || dismissed === text) return null;
  return (
    <div
      role="region"
      aria-label="Announcement"
      className="flex items-start gap-2 border-b border-[color:var(--color-warn)]/30 bg-[color:var(--color-warn)]/10 px-3 py-2 text-sm sm:px-4"
    >
      <Info className="mt-0.5 size-4 shrink-0 text-[color:var(--color-warn)]" aria-hidden />
      <p className="min-w-0 flex-1 break-words text-pretty text-foreground">{text}</p>
      <button
        type="button"
        onClick={() => dismiss(text)}
        className="-my-1 -mr-1.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        aria-label="Dismiss announcement"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
