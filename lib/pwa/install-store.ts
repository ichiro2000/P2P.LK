import { isIosNow, isStandaloneNow, storage } from "./platform";

/**
 * "Install app" state for useSyncExternalStore:
 *   - Chrome/Edge (Android + desktop): the `beforeinstallprompt` event is
 *     caught (listener attached when this module loads, i.e. with the root
 *     layout's PwaRegister) and replayed by `promptInstall()`.
 *   - iPhone/iPad: no prompt API; the UI shows Share → Add to Home Screen.
 *   - Dismissals are remembered in localStorage for 60 days (the sidebar
 *     hint only; the account-menu item stays available).
 */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type InstallSnapshot = {
  /** A captured Chrome install prompt is ready. */
  canPrompt: boolean;
  /** iOS/iPadOS browser tab (not the installed app): show instructions. */
  iosManual: boolean;
  standalone: boolean;
  /** The member closed the sidebar hint recently. */
  dismissed: boolean;
};

export const DISMISS_KEY = "p2plk.install.dismissedAt";
export const DISMISS_MS = 60 * 86400 * 1000;

const SERVER: InstallSnapshot = { canPrompt: false, iosManual: false, standalone: false, dismissed: true };

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
let snapshot: InstallSnapshot = SERVER;
const listeners = new Set<() => void>();

export function isDismissed(raw: string | null, now: number): boolean {
  const at = Number(raw);
  return Number.isFinite(at) && at > 0 && now - at < DISMISS_MS;
}

function compute(): InstallSnapshot {
  const standalone = installed || isStandaloneNow();
  return {
    canPrompt: !!deferred && !standalone,
    iosManual: !standalone && isIosNow(),
    standalone,
    dismissed: isDismissed(storage.get(DISMISS_KEY), Date.now()),
  };
}

function emit() {
  const next = compute();
  if (
    next.canPrompt !== snapshot.canPrompt ||
    next.iosManual !== snapshot.iosManual ||
    next.standalone !== snapshot.standalone ||
    next.dismissed !== snapshot.dismissed
  ) {
    snapshot = next;
  }
  for (const l of listeners) l();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    // Keep Chrome's own mini-infobar out of the way; we offer a quiet button.
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    emit();
  });
  window.addEventListener("storage", (e) => {
    if (e.key === DISMISS_KEY) emit();
  });
  snapshot = compute();
}

export function subscribeInstall(onChange: () => void) {
  listeners.add(onChange);
  const mql = window.matchMedia("(display-mode: standalone)");
  const onMode = () => emit();
  mql.addEventListener("change", onMode);
  return () => {
    listeners.delete(onChange);
    mql.removeEventListener("change", onMode);
  };
}

export const getInstallSnapshot = () => snapshot;
export const getInstallServerSnapshot = () => SERVER;

/** Shows Chrome's install dialog. Returns the outcome, or null when no
 *  prompt is available (already used, or not supported). */
export async function promptInstall(): Promise<"accepted" | "dismissed" | null> {
  const e = deferred;
  if (!e) return null;
  // A prompt event can be used once.
  deferred = null;
  emit();
  try {
    await e.prompt();
    const { outcome } = await e.userChoice;
    return outcome;
  } catch {
    return null;
  }
}

export function dismissInstallHint() {
  storage.set(DISMISS_KEY, String(Date.now()));
  emit();
}
