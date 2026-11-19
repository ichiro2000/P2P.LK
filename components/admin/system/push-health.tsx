import { Card } from "@/components/ui/card";
import { formatInt, formatSLT } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PushHealth as Health } from "@/lib/push/health";

/** /admin/system → Push notifications. Server component. */
export function PushHealth({ health: h }: { health: Health }) {
  const vapidBad = !h.vapid.configured;
  const authProblem = h.lastError?.message.includes("VAPID");
  return (
    <Card className="gap-0 divide-y divide-border py-0" data-testid="push-health">
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">VAPID keys</div>
          <p className="text-xs break-words text-muted-foreground">
            {vapidBad
              ? h.vapid.problem
              : `Configured · public key ${h.vapid.publicKeyTail}. Never rotate casually: it orphans every device.`}
          </p>
        </div>
        <Pill ok={!vapidBad} okText="Configured" badText="Missing" />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3 sm:grid-cols-4">
        <Stat label="Devices" value={formatInt(h.subscriptions)} hint={`${formatInt(h.members)} members`} />
        <Stat label="Delivered 24 h" value={formatInt(h.sent24h)} hint={`${formatInt(h.runs24h)} sends`} />
        <Stat label="Failed 24 h" value={formatInt(h.failed24h)} bad={h.failed24h > 0} />
        <Stat
          label="Failing devices"
          value={formatInt(h.failing)}
          bad={h.failing > 0}
          hint={h.staleDevices ? `${formatInt(h.staleDevices)} not opened in 30 d` : undefined}
        />
      </dl>
      <div className="space-y-1 px-4 py-3 text-xs">
        <div className="text-muted-foreground">
          Last delivered: {h.lastSuccessTs ? formatSLT(h.lastSuccessTs) : "never"}
        </div>
        {h.lastError ? (
          <div className={cn("break-words", authProblem ? "font-medium text-[color:var(--color-sell)]" : "text-muted-foreground")}>
            Last error ({formatSLT(h.lastError.ts)}): {h.lastError.message}
          </div>
        ) : (
          <div className="text-muted-foreground">No push errors in the last 7 days.</div>
        )}
      </div>
    </Card>
  );
}

function Pill({ ok, okText, badText }: { ok: boolean; okText: string; badText: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-medium whitespace-nowrap",
        ok
          ? "border-[color:var(--color-buy)]/40 bg-[color:var(--color-buy)]/10 text-[color:var(--color-buy)]"
          : "border-[color:var(--color-sell)]/40 bg-[color:var(--color-sell)]/10 text-[color:var(--color-sell)]",
      )}
    >
      {ok ? okText : badText}
    </span>
  );
}

function Stat({ label, value, hint, bad }: { label: string; value: string; hint?: string; bad?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("font-mono text-lg tabular-nums", bad && "text-[color:var(--color-sell)]")}>{value}</dd>
      {hint && <dd className="truncate text-[11px] text-muted-foreground">{hint}</dd>}
    </div>
  );
}
