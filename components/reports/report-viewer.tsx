"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Clipboard, Download, FileDown } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { KpiGrid } from "@/components/common/page";
import { KpiCard } from "@/components/common/kpi-card";
import { formatCompact, formatDuration, formatInt, formatPct, formatPrice, formatSLT } from "@/lib/format";
import type { ReportColumn, ReportDocument, ReportTable } from "@/lib/reports";
import { copyToClipboard, documentToCsv, downloadCsv, tableToCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";

/** Rows shown before "Show all" on long tables. */
const PAGE = 20;

export function ReportViewer({
  doc,
  sparks,
}: {
  doc: ReportDocument;
  /** Optional sparkline per meta label (e.g. "Latest mid"). */
  sparks?: Record<string, number[]>;
}) {
  const fileBase = useMemo(() => doc.kind + "_" + new Date().toISOString().replace(/[:.]/g, "-"), [doc.kind]);

  function downloadAll() {
    const csv = documentToCsv(doc.title, doc.tables, doc.meta);
    downloadCsv(`${fileBase}.csv`, csv);
    toast.success("Report downloaded");
  }

  async function copyAll() {
    const csv = documentToCsv(doc.title, doc.tables, doc.meta);
    const ok = await copyToClipboard(csv);
    toast(ok ? "Copied to clipboard" : "Copy failed", { duration: 1800 });
  }

  return (
    <div className="space-y-6">
      <Card className="gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h3 className="text-base font-semibold tracking-tight break-words">{doc.title}</h3>
          <p className="text-xs text-muted-foreground">
            {doc.subtitle}
            <span aria-hidden> · </span>
            <span className="font-mono tabular-nums">Generated {formatSLT(doc.generatedAt)} SLT</span>
          </p>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex">
          <Button variant="outline" className="h-10 sm:h-8" onClick={copyAll}>
            <Clipboard /> Copy CSV
          </Button>
          <Button className="h-10 sm:h-8" onClick={downloadAll}>
            <FileDown /> Download CSV
          </Button>
        </div>
      </Card>

      {doc.meta.length > 0 && (
        <KpiGrid className={doc.meta.length > 4 ? "lg:grid-cols-3 xl:grid-cols-6" : undefined}>
          {doc.meta.map((m) => (
            <KpiCard
              key={m.label}
              label={m.label}
              value={m.value.length > 10 ? <span className="text-base sm:text-lg">{m.value}</span> : m.value}
              spark={sparks?.[m.label]}
              sparkTone="neutral"
            />
          ))}
        </KpiGrid>
      )}

      {doc.tables.map((t) => (
        <TableBlock key={t.id} table={t} fileBase={fileBase} />
      ))}
    </div>
  );
}

function TableBlock({ table, fileBase }: { table: ReportTable; fileBase: string }) {
  const [all, setAll] = useState(false);
  const rows = all ? table.rows : table.rows.slice(0, PAGE);
  const hidden = table.rows.length - rows.length;

  function downloadOne() {
    downloadCsv(`${fileBase}_${table.id}.csv`, tableToCsv(table));
    toast.success(`${table.title} downloaded`);
  }

  // Phone cards: the first name-like column is the card title; "#" and
  // "level" become a prefix and a tag; the rest is a two-column list.
  const titleCol = table.columns.find((c) => c.key === "name" || c.key === "title") ?? table.columns[0];
  const rankCol = table.columns.find((c) => c.key === "rank");
  const levelCol = table.columns.find((c) => c.key === "level");
  const restCols = table.columns.filter((c) => c !== titleCol && c !== rankCol && c !== levelCol);

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="flex flex-row items-start justify-between gap-3 px-4">
        <div className="min-w-0 space-y-1">
          <CardTitle className="text-sm font-medium">{table.title}</CardTitle>
          {table.subtitle && <CardDescription className="text-xs">{table.subtitle}</CardDescription>}
        </div>
        <Button variant="outline" size="sm" className="h-10 shrink-0 sm:h-7" onClick={downloadOne}>
          <Download /> CSV
        </Button>
      </CardHeader>

      <CardContent className="px-0">
        {table.rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">No rows for this report.</p>
        ) : (
          <>
            {/* Phones: stacked cards */}
            <ul className="divide-y border-t md:hidden">
              {rows.map((row, i) => (
                <li key={i} className="space-y-2 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 text-sm font-medium break-words">
                      {rankCol && (
                        <span className="mr-1.5 font-mono text-xs tabular-nums text-muted-foreground">
                          #{formatCell(row[rankCol.key], rankCol.format)}
                        </span>
                      )}
                      {formatCell(row[titleCol.key], titleCol.format)}
                    </div>
                    {levelCol && (
                      <span className={cn("shrink-0 font-mono text-xs font-medium", levelTone(String(row[levelCol.key] ?? "")))}>
                        {formatCell(row[levelCol.key], levelCol.format)}
                      </span>
                    )}
                  </div>
                  {restCols.length > 0 && (
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                      {restCols.map((c) => {
                        const v = row[c.key];
                        const wide = typeof v === "string" && v.length > 24;
                        return (
                          <div key={c.key} className={cn("min-w-0", wide && "col-span-2")}>
                            <dt className="text-muted-foreground">{c.header}</dt>
                            <dd className={cn("break-words text-foreground", !wide && "font-mono tabular-nums")}>
                              {formatCell(v, c.format)}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                  )}
                </li>
              ))}
            </ul>

            {/* md and up: table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    {table.columns.map((c) => (
                      <TableHead
                        key={c.key}
                        className={cn("px-4 text-xs whitespace-nowrap", c.align === "right" && "text-right")}
                      >
                        {c.header}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={i}>
                      {table.columns.map((c) => (
                        <TableCell
                          key={c.key}
                          className={cn(
                            "px-4 text-xs",
                            c.align === "right" && "text-right",
                            isNumeric(c) && "font-mono tabular-nums",
                            c.key === "level" ? cn("font-mono font-medium", levelTone(String(row[c.key] ?? ""))) : "text-foreground",
                            c.key === "detail" && "max-w-md whitespace-normal text-muted-foreground",
                          )}
                        >
                          {formatCell(row[c.key], c.format)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {hidden > 0 && (
              <div className="border-t px-4 pt-3">
                <Button variant="ghost" className="h-10 w-full sm:h-8 sm:w-auto" onClick={() => setAll(true)}>
                  Show all {table.rows.length} rows
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function isNumeric(c: ReportColumn) {
  return c.align === "right" || (c.format != null && c.format !== "datetime");
}

function formatCell(value: string | number | null | undefined, format?: string): React.ReactNode {
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
      return formatSLT(new Date(Number(value)));
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
