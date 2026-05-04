"use client";

import { formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Empty } from "@/components/common/empty";
import { Bell, Trash2 } from "lucide-react";
import {
  alertRules,
  useStorageValue,
  STORAGE_KEYS,
} from "@/lib/storage";
import { RULE_TYPE_META } from "@/lib/alert-engine";
import { formatCompact, formatFiat, formatPct } from "@/lib/format";
import { getFiat } from "@/lib/constants";

export function RulesList() {
  const rules = useStorageValue(
    () => alertRules.list(),
    [STORAGE_KEYS.rules],
    [],
  );

  return (
    <Card className="border-border bg-card/60">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-[13px] font-semibold">
            <Bell className="h-3.5 w-3.5 text-primary" strokeWidth={1.75} />
            Rules
            {rules.length > 0 && (
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                {rules.length}
              </span>
            )}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {rules.length === 0 ? (
          <Empty
            icon={Bell}
            title="No alert rules yet"
            description="Create your first rule above — it'll fire a toast when the live market crosses the threshold you set."
          />
        ) : (
          <div className="rounded-lg border border-border/60 overflow-hidden">
            {rules.map((r) => {
              const meta = RULE_TYPE_META[r.type];
              const fiat = getFiat(r.fiat);
              const symbol = fiat?.symbol ?? r.fiat;
              const thresholdText =
                meta.unit === "price"
                  ? formatFiat(r.threshold, symbol, 4)
                  : meta.unit === "percent"
                    ? formatPct(r.threshold, { frac: 2 })
                    : `${formatCompact(r.threshold)} ${r.asset}`;

              return (
                <div
                  key={r.id}
                  className="flex flex-col gap-2 border-b border-border/60 px-4 py-3 last:border-0 transition-colors hover:bg-accent/40 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-base">{fiat?.flag ?? "🏳"}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-medium text-foreground">
                          {r.asset}/{r.fiat}
                        </span>
                        <Badge
                          variant="outline"
                          className="h-4 border-dashed text-[9px] uppercase tracking-wider text-muted-foreground"
                        >
                          {meta.label}
                        </Badge>
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        Trigger when <span className="font-mono">{meta.comparator}</span>{" "}
                        <span className="font-mono tabular-nums text-foreground/90">
                          {thresholdText}
                        </span>
                        {" · cooldown "}
                        <span className="font-mono tabular-nums">
                          {r.cooldownSec}s
                        </span>
                        {r.lastFiredAt && (
                          <>
                            {" · last fired "}
                            <span className="font-mono">
                              {formatDistanceToNow(
                                new Date(r.lastFiredAt),
                                { addSuffix: true },
                              )}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <Switch
                      checked={r.enabled}
                      onCheckedChange={(checked) =>
                        alertRules.update(r.id, { enabled: checked })
                      }
                      aria-label={
                        r.enabled ? "Disable rule" : "Enable rule"
                      }
                    />
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-[color:var(--color-sell)]"
                      onClick={() => alertRules.remove(r.id)}
                      aria-label="Delete rule"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
