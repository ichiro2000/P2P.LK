"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { usePolling } from "@/hooks/use-polling";
import { notifyNewEvents, useGuestImport, useMemberMode, type MemberEvent } from "@/hooks/use-member-data";
import { EXCHANGE_LABEL, formatRuleValue } from "./meta";

type Inbox = { events: MemberEvent[]; unread: number };

/**
 * Global, mounted once in the app shell. Alerts are evaluated on the server
 * by the cron; this only consumes them.
 *
 *   members → poll /api/me/events?unread=1 every 60 s (paused while the tab
 *             is hidden), toast events that are new since the last poll, and
 *             run the one-time import of this browser's guest workspace.
 *   guests  → nothing.
 */
export function AlertChecker({ intervalMs = 60_000 }: { intervalMs?: number }) {
  const { isMember, userId } = useMemberMode();
  const router = useRouter();
  useGuestImport();

  // Event ids already seen for this user; null until the first poll lands.
  const seen = useRef<{ uid: string | null; ids: Set<string> | null }>({ uid: null, ids: null });

  usePolling<Inbox>(isMember ? "/api/me/events?unread=1&limit=50" : null, {
    enabled: isMember,
    intervalMs,
    pauseWhenHidden: true,
    onSuccess: (inbox) => {
      if (!userId) return;
      const state = seen.current;
      if (state.uid !== userId || state.ids == null) {
        // First poll: one quiet summary instead of a burst of old events.
        seen.current = { uid: userId, ids: new Set(inbox.events.map((e) => e.id)) };
        if (inbox.unread > 0) {
          toast(`${inbox.unread} unread alert${inbox.unread === 1 ? "" : "s"}`, {
            duration: 5000,
            action: { label: "View", onClick: () => router.push("/alerts") },
          });
        }
        return;
      }
      const fresh = inbox.events.filter((e) => !state.ids!.has(e.id));
      for (const e of inbox.events) state.ids.add(e.id);
      if (fresh.length === 0) return;
      notifyNewEvents(userId);
      for (const e of fresh.slice(0, 3)) {
        toast(e.ruleLabel, {
          description: `${EXCHANGE_LABEL[e.exchange]} · observed ${formatRuleValue(e.type, e.observed)}`,
          duration: 8000,
          action: { label: "View", onClick: () => router.push("/alerts") },
        });
      }
      if (fresh.length > 3) toast(`+${fresh.length - 3} more alerts`, { duration: 5000 });
    },
  });

  return null;
}
