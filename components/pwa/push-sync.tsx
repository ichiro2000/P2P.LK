"use client";

import { useEffect } from "react";
import { syncPush } from "@/lib/push/client";

/** Re-sync at most this often on focus; every page load always syncs. */
const FOCUS_THROTTLE_MS = 5 * 60 * 1000;
let lastSync = 0;

/**
 * Members only (mounted by the app shell). Self-heals this device's push
 * subscription on every app open and when the app comes back to the
 * foreground: re-subscribes if the browser dropped or rotated it, re-sends
 * it if the server doesn't know it, swaps it if the VAPID key changed, and
 * refreshes last_seen_at. Never prompts.
 */
export function PushSync() {
  useEffect(() => {
    const run = (force: boolean) => {
      const now = Date.now();
      if (!force && now - lastSync < FOCUS_THROTTLE_MS) return;
      lastSync = now;
      void syncPush();
    };
    run(true);
    const onVisible = () => {
      if (document.visibilityState === "visible") run(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);
  return null;
}
