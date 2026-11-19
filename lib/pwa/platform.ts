/**
 * Browser/platform checks for the install and notification UI. Pure
 * functions take their inputs so they can be unit-tested; the `*Now()`
 * wrappers read the live browser (client only).
 */

/** iPhone/iPad/iPod, including iPadOS that reports itself as a Mac. */
export function isIosDevice(ua: string, platform = "", maxTouchPoints = 0): boolean {
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return platform === "MacIntel" && maxTouchPoints > 1;
}

export function isIosNow(): boolean {
  if (typeof navigator === "undefined") return false;
  return isIosDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
}

/** Launched from the home screen / as an installed app. */
export function isStandaloneNow(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches
  );
}

/** Web Push needs a service worker, PushManager and the Notification API.
 *  On iOS/iPadOS (16.4+) those only exist inside a Home Screen app. */
export function pushSupportedNow(): boolean {
  if (typeof window === "undefined") return false;
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** Safe localStorage (private mode, disabled storage, quota). */
export const storage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch {
      /* storage unavailable: the UI just forgets */
    }
  },
};
