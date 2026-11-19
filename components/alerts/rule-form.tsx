"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Segmented } from "@/components/market/segmented";
import { useExchange } from "@/components/shell/exchange-context";
import { useAlertRules } from "@/hooks/use-member-data";
import { ASSET, FIAT } from "@/lib/constants";
import type { AlertType } from "@/lib/db/schema";
import type { ExchangeId } from "@/lib/exchanges/types";
import { COOLDOWNS, DOLLAR_RULES, EXCHANGE_LABEL, RULE_TYPES, RULE_TYPE_META, cooldownLabel, describeRule } from "./meta";

const FIELD = "h-10 sm:h-9";
const EXCHANGE_OPTS = (["binance", "bybit"] as const).map((ex) => ({ value: ex, label: EXCHANGE_LABEL[ex] }));
const DEFAULT_THRESHOLD: Record<AlertType, number> = {
  priceAbove: 330,
  priceBelow: 320,
  spreadAbove: 1,
  spreadBelow: 0.3,
  depthBelow: 5000,
  askDepthBelow: 2000,
  bidDepthBelow: 2000,
  offMarketAd: 1,
  usdGoogleUp: 0.3,
  usdGoogleDown: 0.3,
  usdCbslUp: 0.5,
  usdCbslDown: 0.5,
};

/** New server-side rule (members only — the page gates guests). */
export function RuleForm() {
  const { exchange: activeExchange } = useExchange();
  const { create, enabled } = useAlertRules();

  const [exchange, setExchange] = useState<ExchangeId>(activeExchange);
  const [type, setType] = useState<AlertType>("priceAbove");
  const [threshold, setThreshold] = useState<string>(String(DEFAULT_THRESHOLD.priceAbove));
  const [cooldown, setCooldown] = useState<number>(1800);
  const [email, setEmail] = useState(true);
  const [saving, setSaving] = useState(false);

  const meta = RULE_TYPE_META[type];
  const unitLabel = meta.unit === "price" ? `${FIAT.symbol} per ${ASSET}` : meta.unit === "percent" ? "%" : ASSET;

  function pickType(t: AlertType) {
    setType(t);
    setThreshold(String(DEFAULT_THRESHOLD[t]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(threshold);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Threshold must be a positive number");
      return;
    }
    const value = meta.unit === "percent" ? n / 100 : n;
    if (meta.unit === "percent" && value > 1) {
      toast.error("Use a percentage up to 100");
      return;
    }
    setSaving(true);
    const rule = await create({
      exchange,
      type,
      threshold: value,
      label: describeRule({ exchange, type, threshold: value }),
      email,
      cooldownSec: cooldown,
    });
    setSaving(false);
    if (rule) toast.success("Alert rule created");
  }

  return (
    <Card className="py-4">
      <CardContent className="px-4">
        <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-start">
          <div className="space-y-1.5">
            <Label>Exchange</Label>
            <Segmented label="Exchange" value={exchange} onChange={setExchange} options={EXCHANGE_OPTS} className="w-full *:flex-1" />
          </div>

          <div className="space-y-1.5 sm:col-span-1 lg:col-span-3">
            <Label htmlFor="rule-type">Condition</Label>
            <Select value={type} onValueChange={(v) => pickType((v as AlertType) ?? "priceAbove")}>
              <SelectTrigger id="rule-type" className={`w-full ${FIELD}`}>
                <SelectValue>{(val) => RULE_TYPE_META[val as AlertType]?.label ?? "Condition"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {RULE_TYPES.map((t) => (
                  <SelectItem key={t} value={t} className="min-h-10 sm:min-h-0">
                    {RULE_TYPE_META[t].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rule-threshold">
              {type === "offMarketAd" ? "Better by (%)" : DOLLAR_RULES.has(type) ? "Dollar move (%)" : `Threshold (${unitLabel})`}
            </Label>
            <Input
              id="rule-threshold"
              type="number"
              inputMode="decimal"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              min={0}
              step={meta.unit === "percent" ? 0.01 : 1}
              className={`font-mono tabular-nums ${FIELD}`}
            />
            <p className="text-xs text-muted-foreground">{meta.hint}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rule-cooldown">Cooldown</Label>
            <Select value={String(cooldown)} onValueChange={(v) => setCooldown(Number(v) || 1800)}>
              <SelectTrigger id="rule-cooldown" className={`w-full ${FIELD}`}>
                <SelectValue>{(val) => cooldownLabel(Number(val))}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {COOLDOWNS.map((c) => (
                  <SelectItem key={c.sec} value={String(c.sec)} className="min-h-10 sm:min-h-0">
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Quiet time after it fires</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rule-email">Email me</Label>
            <div className={`flex items-center gap-2 ${FIELD}`}>
              <Switch id="rule-email" checked={email} onCheckedChange={setEmail} />
              <span className="text-xs text-muted-foreground">{email ? "Email + in-app" : "In-app only"}</span>
            </div>
          </div>

          <div className="lg:pt-6">
            <Button type="submit" disabled={saving || !enabled} className={`w-full ${FIELD}`}>
              <Plus /> {saving ? "Adding…" : enabled ? "Add rule" : "Loading your account…"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
