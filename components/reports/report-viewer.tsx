"use client";

import { useMemo } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  formatCompact,
  formatDuration,
  formatInt,
  formatPct,
  formatPrice,
} from "@/lib/format";
import type { ReportDocument, ReportTable } from "@/lib/reports";
import {
  copyToClipboard,
  documentToCsv,
  downloadCsv,
  tableToCsv,
} from "@/lib/csv";
import { cn } from "@/lib/utils";
import { Clipboard, Download, FileDown } from "lucide-react";

export function ReportViewer({ doc }: { doc: ReportDocument }) {
  const fileBase = useMemo(
    () => doc.kind + "_" + new Date().toISOString().replace(/[:.]/g, "-"),
    [doc.kind],
  );

  function downloadAll() {
    const csv = documentToCsv(doc.title, doc.tables, doc.meta);
    downloadCsv(`${fileBase}.csv`, csv);
    toast.success("Report downloaded");
  }

  async function copyAll() {
    const csv = documentToCsv(doc.title, doc.tables, doc.meta);
    const ok = await copyToClipboard(csv);
    toast(ok ? "Copied to clipboard" : "Copy failed", {
      duration: 1800,
    });
  }

  return (
    <div className="space-y-5">
      <Card className="border-border bg-card/60">
        <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
                Report
              </span>
              <Badge
                variant="outline"
                className="border-dashed bg-transparent text-[9px] uppercase tracking-wider text-muted-foreground"
              >
                {doc.kind}
              </Badge>
            </div>
            <h3 className="mt-1 text-lg font-semibold tracking-tight text-foreground">
              {doc.title}
            </h3>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {doc.subtitle}
            </p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={copyAll}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card/50 px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <Clipboard className="h-3.5 w-3.5" strokeWidth={1.75} />
              Copy
            </button>
            <button
              type="button"
              onClick={downloadAll}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[11px] font-semibold text-primary-foreground transition-colors hover:bg-primary/85"
            >
              <FileDown className="h-3.5 w-3.5" strokeWidth={2} />
              Download CSV
            </button>
          </div>
        </CardHeader>

        <CardContent className="border-t border-border/60 pt-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-3 xl:grid-cols-6">
            {doc.meta.map((m) => (
              <div key={m.label} className="flex flex-col gap-0.5">
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {m.label}
                </dt>
                <dd className="font-mono text-sm tabular-nums text-foreground">
                  {m.value}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-3 font-mono text-[10px] tabular-nums text-muted-foreground/70">
            Generated {new Date(doc.generatedAt).toLocaleString()}
          </div>
        </CardContent>
      </Card>

      {doc.tables.map((t) => (
        <TableBlock key={t.id} table={t} fileBase={fileBase} />
      ))}
    </div>
  );
}

function TableBlock({
  table,
  fileBase,
}: {
  table: ReportTable;
  fileBase: string;
}) {
  function downloadOne() {
    downloadCsv(`${fileBase}_${table.id}.csv`, tableToCsv(table));
    toast.success(`${table.title} downloaded`);
  }

  return (
    <Card className="card-lift border-border bg-card/60">
      <CardHeader className="flex flex-row items-start justify-between pb-2">
        <div>
          <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {table.title}
          </CardTitle>
          {table.subtitle && (
            <p className="mt-0.5 text-[11px] text-muted-foreground/70">
              {table.subtitle}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={downloadOne}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card/50 px-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          <Download className="h-3 w-3" strokeWidth={2} />
          CSV
        </button>
      </CardHeader>

      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                {table.columns.map((c) => (
                  <TableHead
                    key={c.key}
                    className={cn(
                      c.align === "right" && "text-right",
                      "whitespace-nowrap",
                    )}
                  >
                    {c.header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {table.rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={table.columns.length}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    No rows for this report
                  </TableCell>
                </TableRow>
              ) : (
                table.rows.map((row, i) => (
                  <TableRow key={i} className="border-border hover:bg-accent/40">
                    {table.columns.map((c) => (
                      <TableCell
                        key={c.key}
                        className={cn(
                          c.align === "right" && "text-right",
                          "font-mono tabular-nums text-[12px]",
                          c.key === "level"
                            ? levelTone(String(row[c.key] ?? ""))
                            : "text-foreground/85",
                        )}
                      >
                        {formatCell(row[c.key], c.format)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function formatCell(
  value: string | number | null | undefined,
  format?: string,
): React.ReactNode {
  if (value == null || value === "") return "—";
  if (typeof value === "string") return value;
  switch (format) {
    case "price":
      return formatPrice(value, 2);
    case "pct":
      return formatPct(value, { frac: 2, sign: true });
    case "int":
      return formatInt(value);
    case "compact":
      return formatCompact(value);
    case "duration":
      return formatDuration(value);
    case "datetime":
      return new Date(Number(value)).toLocaleString();
    default:
      return Number.isFinite(value) ? String(value) : "—";
  }
}

function levelTone(level: string) {
  switch (level) {
    case "ALERT":
      return "text-[color:var(--color-sell)]";
    case "WARN":
      return "text-[color:var(--color-warn)]";
    case "OK":
      return "text-[color:var(--color-buy)]";
    default:
      return "text-muted-foreground";
  }
}
