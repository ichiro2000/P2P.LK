import { cn } from "@/lib/utils";

export const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

export type HeatCell = {
  /** 0..1 intensity; null = no / too little data (drawn as an empty cell). */
  level: number | null;
  /** Colour of the filled cell. */
  tone: "fg" | "buy" | "sell";
  title: string;
};

const TONE = {
  fg: "bg-foreground",
  buy: "bg-[color:var(--color-buy)]",
  sell: "bg-[color:var(--color-sell)]",
} as const;

/**
 * Weekday × hour grid (Sri Lanka time), 7 rows of 24 cells, or a single
 * "All days" row. Scrolls sideways inside its card on phones; callers add a
 * text summary and a screen-reader table, so the grid itself is aria-hidden.
 */
export function SltHeatGrid({
  rows,
  labels,
  ariaLabel,
}: {
  rows: HeatCell[][];
  labels: readonly string[];
  ariaLabel: string;
}) {
  return (
    <div
      className="-mx-2 overflow-x-auto px-2 pb-1 sm:mx-0 sm:px-0"
      tabIndex={0}
      role="img"
      aria-label={ariaLabel}
    >
      <div aria-hidden className="grid min-w-[560px] grid-cols-[2.75rem_repeat(24,minmax(0,1fr))] gap-[2px]">
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="h-4 text-center font-mono text-[9px] leading-4 text-muted-foreground">
            {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
          </div>
        ))}
        {rows.map((row, d) => (
          <Row key={d} label={labels[d] ?? ""} row={row} />
        ))}
      </div>
    </div>
  );
}

function Row({ label, row }: { label: string; row: HeatCell[] }) {
  return (
    <>
      <div className="flex h-6 items-center font-mono text-[10px] text-muted-foreground">{label}</div>
      {row.map((c, h) =>
        c.level == null ? (
          <div key={h} className="h-6 rounded-[3px] bg-muted/60" title={c.title} />
        ) : (
          <div
            key={h}
            className={cn("h-6 rounded-[3px]", TONE[c.tone])}
            style={{ opacity: 0.1 + Math.max(0, Math.min(1, c.level)) * 0.9 }}
            title={c.title}
          />
        ),
      )}
    </>
  );
}
