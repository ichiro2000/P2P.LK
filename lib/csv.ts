import type { ReportColumn, ReportTable } from "./reports";

/** RFC 4180-ish CSV encoding — handles commas, quotes, newlines. */
export function escapeCell(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s = typeof v === "number" ? String(v) : v;
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function tableToCsv(table: ReportTable): string {
  const header = table.columns.map((c) => escapeCell(c.header)).join(",");
  const lines = table.rows.map((row) =>
    table.columns.map((c) => escapeCell(row[c.key])).join(","),
  );
  return [header, ...lines].join("\n");
}

/** Combine multiple tables with a header comment per block. Useful for
 *  downloading the whole report as one file. */
export function documentToCsv(
  title: string,
  tables: ReportTable[],
  meta: { label: string; value: string }[] = [],
): string {
  const out: string[] = [];
  out.push(`# ${title}`);
  for (const m of meta) out.push(`# ${m.label}: ${m.value}`);
  out.push(`# Generated: ${new Date().toISOString()}`);
  out.push("");
  for (const t of tables) {
    out.push(`# ${t.title}`);
    if (t.subtitle) out.push(`# ${t.subtitle}`);
    out.push(tableToCsv(t));
    out.push("");
  }
  return out.join("\n");
}

/** Trigger a browser download from a CSV string. Safe no-op on SSR. */
export function downloadCsv(filename: string, csv: string) {
  if (typeof window === "undefined") return;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Copy string to the clipboard with a graceful fallback. */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Shared type alias just so callers don't need to import from reports.ts. */
export type { ReportColumn };
