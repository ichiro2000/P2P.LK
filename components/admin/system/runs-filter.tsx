"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const SELECT =
  "h-10 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 text-base text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-9 md:text-sm dark:bg-input/30 dark:scheme-dark";

type Opt = { value: string; label: string };

/** Ingest-run filters. Every filter lives in the URL (shareable, and the
 *  list stays server-rendered); changing one applies it at once. */
export function RunsFilter({
  job,
  exchange,
  failed,
  jobs,
  exchanges,
}: {
  job: string | null;
  exchange: string | null;
  failed: boolean;
  jobs: Opt[];
  exchanges: Opt[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();

  function apply(next: { job?: string | null; exchange?: string | null; failed?: boolean }) {
    const v = { job, exchange, failed, ...next };
    const p = new URLSearchParams();
    if (v.job) p.set("job", v.job);
    if (v.exchange) p.set("exchange", v.exchange);
    if (v.failed) p.set("failed", "1");
    const qs = p.toString();
    start(() => router.replace(`${pathname}${qs ? `?${qs}` : ""}#runs`, { scroll: false }));
  }

  const any = job || exchange || failed;
  return (
    <div className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap">
      <div className="min-w-0 space-y-1.5 sm:w-40">
        <Label htmlFor="runs-job">Job</Label>
        <select
          id="runs-job"
          className={SELECT}
          value={job ?? ""}
          onChange={(e) => apply({ job: e.target.value || null })}
        >
          <option value="">All jobs</option>
          {jobs.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="min-w-0 space-y-1.5 sm:w-48">
        <Label htmlFor="runs-exchange">Exchange / source</Label>
        <select
          id="runs-exchange"
          className={SELECT}
          value={exchange ?? ""}
          onChange={(e) => apply({ exchange: e.target.value || null })}
        >
          <option value="">All</option>
          {exchanges.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <Label className="flex h-10 items-center gap-2 text-sm font-normal sm:h-9">
        <Switch checked={failed} aria-label="Failed runs only" onCheckedChange={(c) => apply({ failed: c })} />
        Failed only
      </Label>
      <div className="flex h-10 items-center gap-2 sm:h-9">
        {any && (
          <Button type="button" variant="ghost" size="sm" onClick={() => apply({ job: null, exchange: null, failed: false })}>
            <X aria-hidden />
            Clear
          </Button>
        )}
        {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading" />}
      </div>
    </div>
  );
}
