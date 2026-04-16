"use client";

import { formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty } from "@/components/common/empty";
import { BellRing, CheckCheck, History, Trash2 } from "lucide-react";
import {
  alertEvents,
  useStorageValue,
  STORAGE_KEYS,
} from "@/lib/storage";
import { RULE_TYPE_META } from "@/lib/alert-engine";
import { formatCompact, formatFiat, formatPct } from "@/lib/format";
import { getFiat } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function EventLog() {
  const events = useStorageValue(
    () => alertEvents.list(),
    [STORAGE_KEYS.events],
    [],
  );
  const unread = events.filter((e) => !e.read).length;

  return (
    <Card className="border-border bg-card/60">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-[13px] font-semibold">
            <History className="h-3.5 w-3.5 text-primary" strokeWidth={1.75} />
            Event log
            {events.length > 0 && (
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                {events.length}
                {unread > 0 && (
                  <span className="ml-1 text-primary">({unread} new)</span>
                )}
              </span>
            )}
          </CardTitle>
          {events.length > 0 && (
            <div className="flex items-center gap-3 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              {unread > 0 && (
                <button
                  type="button"
                  onClick={() => alertEvents.markAllRead()}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  <CheckCheck className="h-3 w-3" strokeWidth={2} />
                  Mark read
                </button>
              )}
              <button
                type="button"
                onClick={() => alertEvents.clear()}
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                <Trash2 className="h-3 w-3" strokeWidth={2} />
                Clear
              </button>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {events.length === 0 ? (
          <Empty
            icon={BellRing}
            title="No events fired yet"
            description="When a rule matches the live market, the event lands here. A toast also pops up if the app is open."
          />
        ) : (
          <div className="rounded-lg border border-border/60 overflow-hidden">
            {events.map((e) => {
              const meta = RULE_TYPE_META[e.type];
              const fiat = getFiat(e.fiat);
              const symbol = fiat?.symbol ?? e.fiat;
              const observed =
                meta.unit === "price"
                  ? formatFiat(e.observed, symbol, 2)
                  : meta.unit === "percent"
                    ? formatPct(e.observed, { frac: 2 })
                    : `${formatCompact(e.observed)} ${e.asset}`;
              const threshold =
                meta.unit === "price"
                  ? formatFiat(e.threshold, symbol, 2)
                  : meta.unit === "percent"
                    ? formatPct(e.threshold, { frac: 2 })
                    : `${formatCompact(e.threshold)} ${e.asset}`;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => alertEvents.markRead(e.id)}
                  className={cn(
                    "w-full text-left border-b border-border/60 px-4 py-3 last:border-0 transition-colors hover:bg-accent/40",
                    !e.read && "bg-primary/[0.04]",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      {!e.read && (
                        <span
                          aria-hidden
                          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                        />
                      )}
                      <span className="font-mono text-sm font-medium text-foreground">
                        {e.asset}/{e.fiat}
                      </span>
                      <span className="truncate text-[12px] text-muted-foreground">
                        {meta.label} {meta.comparator}{" "}
                        <span className="font-mono tabular-nums text-foreground/80">
                          {threshold}
                        </span>
                      </span>
                    </div>
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                      {formatDistanceToNow(new Date(e.at), { addSuffix: true })}
                    </span>
                  </div>
                  <div className="mt-1 pl-3 font-mono text-[11px] tabular-nums text-[color:var(--color-warn)]">
                    observed {observed}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
