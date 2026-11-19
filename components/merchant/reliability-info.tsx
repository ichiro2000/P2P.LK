"use client";

import { Fragment } from "react";
import { InfoPopover } from "@/components/common/info-popover";
import { RELIABILITY_EXPLAINER, type ReliabilityParts } from "@/lib/merchant-score";
import { formatPct } from "@/lib/format";

/** "How it's calculated" for the reliability score, optionally with one
 *  merchant's breakdown. */
export function ReliabilityInfo({ parts, className }: { parts?: ReliabilityParts | null; className?: string }) {
  const pts = (v: number | null) => (v == null ? "n/a" : v.toFixed(1));
  return (
    <InfoPopover label="How the reliability score is calculated" title="Reliability score, 0–100" className={className}>
      <ul className="list-disc space-y-1 pl-4">
        {RELIABILITY_EXPLAINER.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {parts && (
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-t border-border pt-1.5 font-mono tabular-nums">
          {(
            [
              [`Completion (lower bound ${formatPct(parts.completionLB, { frac: 1 })})`, parts.points.completion],
              ["Volume", parts.points.volume],
              [`Feedback${parts.feedback != null ? ` (lower bound ${formatPct(parts.feedback, { frac: 1 })})` : ""}`, parts.points.feedback],
              [`Release time${parts.release != null ? ` (${formatPct(parts.release, { frac: 0 })})` : ""}`, parts.points.release],
              [`Presence${parts.presence != null ? ` (${formatPct(parts.presence, { frac: 0 })})` : ""}`, parts.points.presence],
              [`Tenure${parts.tenure != null ? ` (${formatPct(parts.tenure, { frac: 0 })})` : ""}`, parts.points.tenure],
              [`Account age${parts.accountAge != null ? ` (${formatPct(parts.accountAge, { frac: 0 })})` : ""}`, parts.points.accountAge],
            ] as const
          ).map(([label, v]) => (
            <Fragment key={label.split(" ")[0]}>
              <dt className="font-sans">{label}</dt>
              <dd className="text-right text-foreground">{pts(v)}</dd>
            </Fragment>
          ))}
        </dl>
      )}
    </InfoPopover>
  );
}
