import type { FxRateType } from "@/lib/db/schema";
import type { FxCurrency } from "./currencies";

export type { FxRateType };

/** One parsed value: LKR per 1 unit of `currency`. */
export type ParsedRate = {
  currency: FxCurrency;
  rateType: FxRateType;
  value: number;
  /** YYYY-MM-DD the source says this rate is for (SLT). */
  asOf: string;
};

export type SourceKind = "central-bank" | "bank";

export type FetchCtx = {
  /** Current time, for "today" and date-range requests. */
  now: Date;
  signal: AbortSignal;
  /** Number of days of history already stored for this source (lets the CBSL
   *  source ask for a longer range on its first run). */
  storedDays: number;
};

/**
 * A rate source. Each makes exactly ONE HTTP request per run, parses strictly
 * and throws on anything unexpected (layout change, missing USD, implausible
 * numbers) so a broken parser shows up in `ingest_runs` instead of writing
 * junk.
 */
export type FxSource = {
  id: string;
  name: string;
  shortName: string;
  kind: SourceKind;
  /** The public page a human would read (shown as attribution). */
  pageUrl: string;
  /** Host, used to space out requests to the same server. */
  host: string;
  fetch(ctx: FetchCtx): Promise<ParsedRate[]>;
};
