"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { InfoPopover } from "@/components/common/info-popover";
import { useFeeSettings } from "@/hooks/use-fee-settings";
import {
  DEFAULT_BASE_MAKER_FEE,
  DEFAULT_MIN_FEE_USDT,
  LEVEL_DISCOUNT,
  LEVEL_LABEL,
  MERCHANT_LEVELS,
  makerFeeRate,
  pctText,
  type MerchantLevel,
} from "@/lib/fees";
import { cn } from "@/lib/utils";

/**
 * "Your fees" control, shared by every calculator: merchant level (Binance
 * verified-merchant discount), base maker fee and the per-order minimum.
 * Takers always pay 0 %.
 */
export function FeeSettingsControl({ className, compact = false }: { className?: string; compact?: boolean }) {
  const [fees, setFees] = useFeeSettings();
  // Text drafts so typing "0." doesn't fight the parsed value.
  const [baseDraft, setBaseDraft] = useState<string | null>(null);
  const [minDraft, setMinDraft] = useState<string | null>(null);
  const rate = makerFeeRate(fees);

  return (
    <div className={cn("space-y-3 rounded-lg border border-border p-3", className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium">Your fees</div>
          <p className="text-xs text-muted-foreground">
            Posting an ad (maker): <span className="font-mono font-medium text-foreground tabular-nums">{pctText(rate)}</span>{" "}
            per side, min {fees.minFeeUsdt} USDT per order · Answering an ad (taker): 0%
          </p>
        </div>
        <InfoPopover label="How fees are calculated" title="P2P fees">
          <p>
            Takers pay no trading fee. Makers pay a fee on each filled order, in USDT. Binance&apos;s LKR maker fee is{" "}
            {pctText(DEFAULT_BASE_MAKER_FEE, 2)} per side before discounts.
          </p>
          <table className="mt-2 w-full text-left text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1 font-medium">Level</th>
                <th className="py-1 font-medium">Discount</th>
                <th className="py-1 font-medium">Maker fee</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {MERCHANT_LEVELS.map((l) => (
                <tr key={l}>
                  <td className="py-0.5 font-sans">{LEVEL_LABEL[l]}</td>
                  <td>{(LEVEL_DISCOUNT[l] * 100).toFixed(0)}%</td>
                  <td>{pctText(makerFeeRate({ level: l, baseMakerFee: fees.baseMakerFee }))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2">
            Each filled order pays max(rate × amount, {DEFAULT_MIN_FEE_USDT} USDT) — the fixed amount on Binance&apos;s fee
            page. Check your own fee page and edit these if yours differ.
          </p>
        </InfoPopover>
      </div>

      <ToggleGroup
        value={[fees.level]}
        onValueChange={(v) => v[0] && setFees({ level: v[0] as MerchantLevel })}
        variant="outline"
        size="sm"
        spacing={0}
        aria-label="Your merchant level"
        className="flex w-full flex-wrap"
      >
        {MERCHANT_LEVELS.map((l) => (
          <ToggleGroupItem key={l} value={l} className="min-h-9 flex-1 px-2 text-xs">
            {l === "none" ? "None" : LEVEL_LABEL[l]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {!compact && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="fee-base" className="text-xs">
              Base maker fee %
            </Label>
            <Input
              id="fee-base"
              inputMode="decimal"
              className="h-10 font-mono tabular-nums"
              value={baseDraft ?? String(+(fees.baseMakerFee * 100).toFixed(4))}
              onChange={(e) => {
                setBaseDraft(e.target.value);
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 0 && n <= 5) setFees({ baseMakerFee: n / 100 });
              }}
              onBlur={() => setBaseDraft(null)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fee-min" className="text-xs">
              Min fee per order (USDT)
            </Label>
            <Input
              id="fee-min"
              inputMode="decimal"
              className="h-10 font-mono tabular-nums"
              value={minDraft ?? String(fees.minFeeUsdt)}
              onChange={(e) => {
                setMinDraft(e.target.value);
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 0 && n <= 100) setFees({ minFeeUsdt: n });
              }}
              onBlur={() => setMinDraft(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
