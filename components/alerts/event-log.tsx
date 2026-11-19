"use client";

import { formatDistanceToNow } from "date-fns";
import { BellRing, CheckCheck, Mail, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty } from "@/components/common/empty";
import { useAlertEvents } from "@/hooks/use-member-data";
import { cn } from "@/lib/utils";
import { EXCHANGE_LABEL, RULE_TYPE_META, formatRuleValue } from "./meta";

/** Toolbar for the event log section header (mark read / clear). */
export function EventLogActions() {
  const { events, unread, markRead, clear } = useAlertEvents();
  if (events.length === 0) return null;
  return (
    <div className="flex items-center gap-1">
      {unread > 0 && (
        <Button variant="ghost" size="sm" className="h-10 sm:h-7" onClick={() => markRead()}>
          <CheckCheck /> Mark read
        </Button>
      )}
      <Button variant="ghost" size="sm" className="h-10 sm:h-7" onClick={() => clear()}>
        <Trash2 /> Clear
      </Button>
    </div>
  );
}

/** The member's alert inbox (fired by the server every minute). */
export function EventLog() {
  const { events, markRead, ready } = useAlertEvents();

  if (!ready) return <Skeleton className="h-32 w-full rounded-xl" />;

  if (events.length === 0) {
    return (
      <Empty
        icon={BellRing}
        title="No events yet"
        description="When a rule matches the live market, the event lands here and, if you asked for it, in your email."
      />
    );
  }

  return (
    <Card className="gap-0 py-0">
      <ul className="divide-y">
        {events.map((e) => {
          const meta = RULE_TYPE_META[e.type];
          return (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => !e.read && markRead([e.id])}
                className={cn(
                  "w-full space-y-1 px-4 py-3 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted",
                  !e.read && "bg-muted/40",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    {!e.read && (
                      <span className="size-2 shrink-0 rounded-full bg-[color:var(--color-warn)]" aria-label="Unread" />
                    )}
                    <span className="truncate text-sm font-medium">{e.ruleLabel}</span>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(e.ts * 1000), { addSuffix: true })}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span>{EXCHANGE_LABEL[e.exchange]}</span>
                  <span>
                    Observed{" "}
                    <span className="font-mono tabular-nums text-foreground">{formatRuleValue(e.type, e.observed)}</span>
                  </span>
                  <span>
                    Rule {meta.comparator}{" "}
                    <span className="font-mono tabular-nums">{formatRuleValue(e.type, e.threshold)}</span>
                  </span>
                  {e.emailed && (
                    <span className="inline-flex items-center gap-1">
                      <Mail className="size-3" /> emailed
                    </span>
                  )}
                </div>
                {e.detail && <p className="text-xs text-muted-foreground">{e.detail}</p>}
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
