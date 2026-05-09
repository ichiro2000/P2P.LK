/**
 * Companion to scripts/import-suspicious-qrs.ts. After the dry-run produces
 * `susqr-import-preview.csv`, this script POSTs every `status=to_submit` row
 * to /api/suspicious. Splitting the two phases lets you re-run the slow
 * decode/resolve work once and the fast submit work as many times as needed.
 *
 * Usage:
 *   tsx scripts/submit-suspicious-from-csv.ts <csv-path>
 *
 * Env (same as the importer):
 *   SUSQR_API           — endpoint URL (default https://p2p.lk/api/suspicious)
 *   SUSQR_ADMIN_TOKEN   — required
 *   SUSQR_REASON        — default "Admin Added"
 *   SUSQR_THROTTLE_MS   — default 700
 */

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";

type Row = {
  status: string;
  advertiserNo: string;
  profileUrl: string;
  isShortLink: string;
  fileCount: string;
  exampleFile: string;
  raw: string;
};

/** Tiny CSV parser tuned for the importer's output (always-quoted text
 *  cells, one record per line). Handles escaped `""` inside quoted fields
 *  and the unquoted numeric `isShortLink`/`fileCount` columns. */
function parseCsv(text: string): Row[] {
  const lines: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      // Toggle quote state, but respect "" as an escaped quote.
      if (inQ && text[i + 1] === '"') {
        cur += '""';
        i++;
        continue;
      }
      inQ = !inQ;
      cur += c;
    } else if ((c === "\n" || c === "\r") && !inQ) {
      if (cur.length) lines.push(cur);
      cur = "";
      // Eat \r\n.
      if (c === "\r" && text[i + 1] === "\n") i++;
    } else {
      cur += c;
    }
  }
  if (cur.length) lines.push(cur);
  if (!lines.length) return [];

  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const obj: Record<string, string> = {};
    header.forEach((h, i) => {
      obj[h] = cells[i] ?? "";
    });
    return obj as unknown as Row;
  });
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        inQ = !inQ;
      }
    } else if (c === "," && !inQ) {
      out.push(cell);
      cell = "";
    } else {
      cell += c;
    }
  }
  out.push(cell);
  return out;
}

function csvCell(s: string | null | undefined): string {
  return `"${(s ?? "").replace(/"/g, '""')}"`;
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error("usage: tsx scripts/submit-suspicious-from-csv.ts <csv-path>");
    process.exit(1);
  }
  const API_URL = process.env.SUSQR_API ?? "https://p2p.lk/api/suspicious";
  const TOKEN = process.env.SUSQR_ADMIN_TOKEN ?? "";
  const REASON = process.env.SUSQR_REASON ?? "Admin Added";
  const THROTTLE_MS = Number(process.env.SUSQR_THROTTLE_MS ?? 700);

  if (!TOKEN) {
    console.error("[submit] SUSQR_ADMIN_TOKEN is required");
    process.exit(1);
  }

  const text = await fs.readFile(csvPath, "utf8");
  const rows = parseCsv(text);
  let toSubmit = rows.filter((r) => r.status === "to_submit");
  console.log(
    `[submit] ${rows.length} CSV rows total, ${toSubmit.length} marked to_submit`,
  );
  console.log(
    `[submit] target=${API_URL} reason="${REASON}" throttle=${THROTTLE_MS}ms`,
  );

  // Re-fetch existing registry to drop anything inserted between dry-run and
  // now (e.g. probe POSTs, partial earlier runs, manual entries). Without
  // this the script will happily double-insert because the API has no
  // unique constraint on advertiserNo.
  try {
    const res = await fetch(API_URL, { cache: "no-store" });
    if (res.ok) {
      const j = (await res.json()) as { reports: Array<{ binanceUserId: string }> };
      const have = new Set((j.reports ?? []).map((r) => r.binanceUserId));
      const before = toSubmit.length;
      toSubmit = toSubmit.filter((r) => !have.has(r.advertiserNo));
      const skipped = before - toSubmit.length;
      console.log(
        `[submit] registry has ${have.size} active reports; skipping ${skipped} already-present rows; ${toSubmit.length} remain`,
      );
    } else {
      console.warn(
        `[submit] could not refresh registry (${res.status}); proceeding without existing-dedupe`,
      );
    }
  } catch (e) {
    console.warn(
      `[submit] registry refresh failed: ${e instanceof Error ? e.message : e}`,
    );
  }

  let submitted = 0;
  let failed = 0;
  const failures: { advertiserNo: string; error: string }[] = [];

  for (const r of toSubmit) {
    try {
      const body = {
        decoded: r.profileUrl || r.raw,
        displayName: null,
        reason: REASON,
        notes: null,
        reporter: null,
      };
      const res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-token": TOKEN,
        },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        submitted++;
      } else {
        failed++;
        const txt = await res.text().catch(() => "");
        failures.push({
          advertiserNo: r.advertiserNo,
          error: `${res.status}: ${txt.slice(0, 200)}`,
        });
      }
    } catch (e) {
      failed++;
      failures.push({
        advertiserNo: r.advertiserNo,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    if (
      (submitted + failed) % 20 === 0 ||
      submitted + failed === toSubmit.length
    ) {
      console.log(
        `[submit] progress ${submitted + failed}/${toSubmit.length} (ok=${submitted} fail=${failed})`,
      );
    }
    await new Promise((res) => setTimeout(res, THROTTLE_MS));
  }

  console.log(`[submit] done. submitted=${submitted} failed=${failed}`);

  if (failures.length) {
    const failPath = path.join(
      path.dirname(csvPath),
      "susqr-failures.csv",
    );
    await fs.writeFile(
      failPath,
      "advertiserNo,error\n" +
        failures
          .map(
            (f) => `${csvCell(f.advertiserNo)},${csvCell(f.error)}`,
          )
          .join("\n") +
        "\n",
      "utf8",
    );
    console.log(`[submit] failures written: ${failPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
