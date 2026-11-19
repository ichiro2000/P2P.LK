import { formatDuration } from "@/lib/format";

/** "3m ago" from two unix-second timestamps (server-rendered, no clock drift). */
export function ago(ts: number | null | undefined, now: number): string {
  if (ts == null) return "never";
  const d = now - ts;
  if (d < 5) return "just now";
  return `${formatDuration(d)} ago`;
}

export function ms(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v < 1000) return `${Math.round(v)} ms`;
  return `${(v / 1000).toFixed(v < 10_000 ? 1 : 0)} s`;
}

export function bytes(n: number | null | undefined): string {
  if (n == null) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export const JOB_LABEL: Record<string, string> = {
  book: "Book",
  sweep: "Sweep",
  alerts: "Alerts",
  push: "Push",
  rollup: "Rollup",
  takers: "Takers",
  fx: "FX rates",
  retention: "Retention",
};

const EX_LABEL: Record<string, string> = { binance: "Binance", bybit: "Bybit" };
export const exLabel = (ex: string | null | undefined) => (ex ? (EX_LABEL[ex] ?? ex) : "");
