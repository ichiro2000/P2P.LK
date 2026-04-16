"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ASSET, FIAT } from "@/lib/constants";
import { alertRules, type AlertRuleType } from "@/lib/storage";
import { RULE_TYPE_META } from "@/lib/alert-engine";

const TYPE_ORDER: AlertRuleType[] = [
  "priceAbove",
  "priceBelow",
  "spreadAbove",
  "spreadBelow",
  "depthBelow",
];

export function RuleForm() {
  // Asset and fiat are product-scoped — no picker needed.
  const asset = ASSET;
  const fiat = FIAT.code;
  const symbol = FIAT.symbol;

  const [type, setType] = useState<AlertRuleType>("priceAbove");
  const [threshold, setThreshold] = useState<number>(330);
  const [cooldown, setCooldown] = useState<number>(300);

  const meta = RULE_TYPE_META[type];

  const unitLabel =
    meta.unit === "price"
      ? `${symbol} / ${asset}`
      : meta.unit === "percent"
        ? "% (e.g. 0.5 for 0.5%)"
        : `${asset} (e.g. 5000)`;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!Number.isFinite(threshold) || threshold <= 0) {
      toast.error("Threshold must be a positive number");
      return;
    }
    const internal = meta.unit === "percent" ? threshold / 100 : threshold;

    alertRules.create({
      type,
      asset,
      fiat,
      threshold: internal,
      cooldownSec: Math.max(30, cooldown),
    });
    toast.success("Alert rule created");
  }

  return (
    <Card className="card-lift border-border bg-card/60">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          <span>New alert rule</span>
          <span className="font-mono text-[10px] tracking-wider text-muted-foreground/70">
            {asset}/{fiat}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={submit}
          className="grid grid-cols-2 gap-3 md:grid-cols-[minmax(200px,1fr)_150px_130px_auto]"
        >
          <Field label="Condition">
            <Select
              value={type}
              onValueChange={(v) => setType((v as AlertRuleType) ?? "priceAbove")}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(val) =>
                    RULE_TYPE_META[val as AlertRuleType]?.label ?? "Condition"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {TYPE_ORDER.map((t) => (
                  <SelectItem key={t} value={t}>
                    {RULE_TYPE_META[t].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label={`Threshold · ${unitLabel}`}>
            <Input
              type="number"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value) || 0)}
              min={0}
              step={meta.unit === "percent" ? 0.01 : 1}
              className="font-mono tabular-nums"
            />
          </Field>

          <Field label="Cooldown (sec)">
            <Input
              type="number"
              value={cooldown}
              onChange={(e) => setCooldown(Number(e.target.value) || 300)}
              min={30}
              step={30}
              className="font-mono tabular-nums"
            />
          </Field>

          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-transparent select-none">
              .
            </Label>
            <Button type="submit" className="h-8 gap-1.5">
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              Add rule
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
