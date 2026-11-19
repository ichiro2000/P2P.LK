"use client";

import { formatDistanceToNow } from "date-fns";
import { Bell, Mail, MailX, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty } from "@/components/common/empty";
import { useAlertRules } from "@/hooks/use-member-data";
import { cn } from "@/lib/utils";
import { EXCHANGE_LABEL, RULE_TYPE_META, cooldownLabel, formatRuleValue } from "./meta";

export function RulesList() {
  const { rules, update, remove, ready } = useAlertRules();

  if (!ready) return <Skeleton className="h-32 w-full rounded-xl" />;

  if (rules.length === 0) {
    return (
      <Empty
        icon={Bell}
        title="No alert rules yet"
        description="Create a rule above. We check it against the live market every minute, even when this tab is closed."
      />
    );
  }

  return (
    <Card className="gap-0 py-0">
      <ul className="divide-y">
        {rules.map((r) => {
          const meta = RULE_TYPE_META[r.type];
          return (
            <li key={r.id} className={cn("flex items-start gap-2 px-4 py-3", !r.enabled && "opacity-60")}>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary">{EXCHANGE_LABEL[r.exchange]}</Badge>
                  <Badge variant="outline">{meta.short}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  When <span className="font-mono">{meta.comparator}</span>{" "}
                  <span className="font-mono tabular-nums text-foreground">{formatRuleValue(r.type, r.threshold)}</span>
                  {r.type === "offMarketAd" && " vs the top-5 average"}
                  <span aria-hidden> · </span>
                  cooldown {cooldownLabel(r.cooldownSec)}
                  {r.lastFiredAt && (
                    <>
                      <span aria-hidden> · </span>
                      last fired {formatDistanceToNow(new Date(r.lastFiredAt * 1000), { addSuffix: true })}
                    </>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn("size-10", r.email ? "text-foreground" : "text-muted-foreground")}
                  onClick={() => update(r.id, { email: !r.email })}
                  aria-pressed={r.email}
                  aria-label={r.email ? "Stop emailing this alert" : "Email me this alert"}
                  title={r.email ? "Email on" : "Email off"}
                >
                  {r.email ? <Mail /> : <MailX />}
                </Button>
                <div className="flex size-10 items-center justify-center">
                  <Switch
                    checked={r.enabled}
                    onCheckedChange={(checked) => update(r.id, { enabled: checked })}
                    aria-label={r.enabled ? "Turn rule off" : "Turn rule on"}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-10 text-muted-foreground hover:text-[color:var(--color-sell)]"
                  onClick={() => remove(r.id)}
                  aria-label="Delete rule"
                >
                  <Trash2 />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
