"use client";

import { useEffect } from "react";
// Imported for its side effect too: attaches the `beforeinstallprompt`
// listener as early as possible (this component is in the root layout).
import "@/lib/pwa/install-store";
import { IosInstallDialogHost } from "./install";

/** Registers /sw.js (scope "/") on every page, after load. Also handles the
 *  service worker's "navigate" fallback message from a notification click,
 *  and hosts the iOS "Add to Home Screen" dialog. */
export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch((err) => console.warn(`[pwa] service worker registration failed: ${(err as Error).message}`));
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; url?: string } | null;
      if (d?.type !== "p2plk:navigate" || typeof d.url !== "string") return;
      try {
        const u = new URL(d.url, location.origin);
        if (u.origin === location.origin) location.assign(u.pathname + u.search + u.hash);
      } catch {
        /* ignore */
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("load", register);
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, []);
  return <IosInstallDialogHost />;
}
