import { formatSLT } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * "as of 14:05 SLT", turning into a warning when the data is stale (F24).
 * `stale` is decided on the server (lib/db/queries `freshness`), so this
 * stays a pure component.
 */
export function AsOf({
  ts,
  stale,
  className,
  prefix = "as of",
}: {
  ts: number | null | undefined;
  stale: boolean;
  className?: string;
  prefix?: string;
}) {
  if (ts == null) {
    return <span className={cn(className, "text-[color:var(--color-warn)]")}>no data yet</span>;
  }
  // Stale data may be days old, so it gets the date too.
  const time = stale ? formatSLT(ts) : formatSLT(ts, { timeStyle: "short", dateStyle: undefined });
  return (
    <span className={cn(className, stale && "font-medium text-[color:var(--color-warn)]")}>
      {stale ? `stale · last data ${time} SLT` : `${prefix} ${time} SLT`}
    </span>
  );
}
