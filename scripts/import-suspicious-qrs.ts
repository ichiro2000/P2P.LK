/**
 * Bulk-import a directory of Binance Share-Profile QR images into the
 * Suspicious Takers registry.
 *
 * Workflow (matches the single-shot /suspicious/new form path, just batched):
 *
 *   1. Walk the directory for image files.
 *   2. Decode each image with jimp + jsqr in Node.
 *   3. Group by raw decoded string (cheap dedupe — same QR photographed
 *      twice usually decodes byte-identically).
 *   4. For each unique payload, run parseBinanceProfile to get an
 *      advertiserNo. If the QR is a short-link (binance.com/qr/XXX), fall
 *      back to resolveBinanceProfile which follows the redirect (and uses
 *      Playwright for the WAF-challenged path).
 *   5. Dedupe by canonical advertiserNo.
 *   6. GET /api/suspicious to drop entries already in the registry.
 *   7. Write a CSV preview alongside the input directory.
 *   8. With --commit, POST each remaining entry to /api/suspicious with a
 *      throttle. Without --commit, the script stops after the CSV (dry run).
 *
 * Usage:
 *   tsx scripts/import-suspicious-qrs.ts <dir>            # dry-run
 *   tsx scripts/import-suspicious-qrs.ts <dir> --commit   # actually post
 *
 * Env (all optional):
 *   SUSQR_API           — endpoint URL (default https://p2p.lk/api/suspicious)
 *   SUSQR_ADMIN_TOKEN   — x-admin-token value
 *   SUSQR_REASON        — reason text stored on every report (default "Admin Added")
 *   SUSQR_THROTTLE_MS   — sleep between POSTs (default 700)
 *   SUSQR_CONCURRENCY   — image-decode concurrency (default 8)
 */

import "dotenv/config";
import { Jimp } from "jimp";
import jsQR from "jsqr";
import fs from "node:fs/promises";
import path from "node:path";

import { parseBinanceProfile } from "../lib/qr";
import { resolveBinanceProfile } from "../lib/qr-resolve";

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp"]);

/** Real Binance advertiserNos look like `s<32 hex chars>`. We use the same
 *  loose regex as the form to detect "we got a real one" vs "still a short
 *  link / opaque URL fallback". */
function looksLikeRealAdvertiserNo(v: string): boolean {
  return /^[sS]?[A-Za-z0-9]{16,}$/.test(v) && !v.includes("/") && !v.includes("?");
}

type DecodeResult = {
  file: string;
  decoded: string | null;
  error: string | null;
};

async function decodeOne(filePath: string): Promise<DecodeResult> {
  try {
    const img = await Jimp.read(filePath);
    // Downscale large phone-camera shots — jsQR is O(w·h) and a 4000×4000
    // photo doubles decode time without improving accuracy.
    const maxDim = Math.max(img.bitmap.width, img.bitmap.height);
    const TARGET = 1200;
    if (maxDim > TARGET) {
      const scale = TARGET / maxDim;
      img.resize({
        w: Math.round(img.bitmap.width * scale),
        h: Math.round(img.bitmap.height * scale),
      });
    }
    const { data, width, height } = img.bitmap;
    const result = jsQR(new Uint8ClampedArray(data), width, height, {
      inversionAttempts: "attemptBoth",
    });
    if (!result?.data) {
      return { file: filePath, decoded: null, error: "no QR found in image" };
    }
    return { file: filePath, decoded: result.data, error: null };
  } catch (err) {
    return {
      file: filePath,
      decoded: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function csvCell(s: string | null | undefined): string {
  return `"${(s ?? "").replace(/"/g, '""')}"`;
}

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const positional = args.filter((a) => !a.startsWith("--"));
  const dir = positional[0];
  if (!dir) {
    console.error(
      "usage: tsx scripts/import-suspicious-qrs.ts <dir> [--commit] [--no-resolve]",
    );
    process.exit(1);
  }

  const COMMIT = flags.has("--commit");
  const RESOLVE = !flags.has("--no-resolve");

  const API_URL = process.env.SUSQR_API ?? "https://p2p.lk/api/suspicious";
  const TOKEN = process.env.SUSQR_ADMIN_TOKEN ?? "";
  const REASON = process.env.SUSQR_REASON ?? "Admin Added";
  const THROTTLE_MS = Number(process.env.SUSQR_THROTTLE_MS ?? 700);
  const CONC = Number(process.env.SUSQR_CONCURRENCY ?? 8);

  if (COMMIT && !TOKEN) {
    console.error(
      "[susqr] --commit requires SUSQR_ADMIN_TOKEN to be set in the environment",
    );
    process.exit(1);
  }

  console.log(`[susqr] scanning ${dir}`);
  const dirEntries = await fs.readdir(dir, { withFileTypes: true });
  const files = dirEntries
    .filter((e) => e.isFile())
    .map((e) => path.join(dir, e.name))
    .filter((p) => IMAGE_EXT.has(path.extname(p).toLowerCase()));
  console.log(`[susqr] ${files.length} image files`);

  // 1. Decode (parallel, bounded).
  const decoded: DecodeResult[] = [];
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: CONC }, async () => {
      while (next < files.length) {
        const idx = next++;
        const r = await decodeOne(files[idx]);
        decoded.push(r);
        done++;
        if (done % 50 === 0 || done === files.length) {
          console.log(`[susqr] decoded ${done}/${files.length}`);
        }
      }
    }),
  );

  const decodedOk = decoded.filter((d) => d.decoded);
  const decodeFailed = decoded.filter((d) => !d.decoded);
  console.log(
    `[susqr] decode ok=${decodedOk.length} failed=${decodeFailed.length}`,
  );

  // 2. Group by raw decoded payload.
  const byRaw = new Map<string, string[]>();
  for (const d of decodedOk) {
    const arr = byRaw.get(d.decoded!) ?? [];
    arr.push(d.file);
    byRaw.set(d.decoded!, arr);
  }
  console.log(`[susqr] unique decoded payloads: ${byRaw.size}`);

  // 3. Resolve each unique payload to an advertiserNo. Sync parser first,
  //    then short-link follow if necessary.
  type Resolved = {
    raw: string;
    files: string[];
    userId: string | null;
    profileUrl: string | null;
    isShortLink: boolean;
    error: string | null;
  };

  const resolved: Resolved[] = [];
  let r_i = 0;
  for (const [raw, fileList] of byRaw.entries()) {
    r_i++;
    const res: Resolved = {
      raw,
      files: fileList,
      userId: null,
      profileUrl: null,
      isShortLink: false,
      error: null,
    };
    const sync = parseBinanceProfile(raw);
    if (sync && looksLikeRealAdvertiserNo(sync.userId)) {
      res.userId = sync.userId;
      res.profileUrl = sync.profileUrl;
    } else if (sync) {
      res.userId = sync.userId;
      res.profileUrl = sync.profileUrl;
      res.isShortLink = true;
      if (RESOLVE) {
        try {
          const fixed = await resolveBinanceProfile(raw);
          if (fixed && looksLikeRealAdvertiserNo(fixed.userId)) {
            res.userId = fixed.userId;
            res.profileUrl = fixed.profileUrl;
            res.isShortLink = false;
          }
        } catch (e) {
          res.error = e instanceof Error ? e.message : String(e);
        }
      }
    } else {
      res.error = "no Binance profile parsed from QR content";
    }
    resolved.push(res);
    if (r_i % 25 === 0 || r_i === byRaw.size) {
      console.log(`[susqr] resolved ${r_i}/${byRaw.size}`);
    }
  }

  // 4. Dedupe by canonical advertiserNo.
  const uniqByUser = new Map<string, Resolved>();
  for (const r of resolved) {
    if (!r.userId) continue;
    const existing = uniqByUser.get(r.userId);
    if (!existing) {
      uniqByUser.set(r.userId, { ...r, files: [...r.files] });
    } else {
      existing.files.push(...r.files);
      // Prefer the resolved (real) advertiserNo over a short-link entry.
      if (existing.isShortLink && !r.isShortLink) {
        existing.isShortLink = false;
        existing.profileUrl = r.profileUrl;
      }
    }
  }

  // 5. Skip anything already in the registry.
  console.log(`[susqr] fetching existing registry from ${API_URL}`);
  const existingIds = new Set<string>();
  try {
    const res = await fetch(API_URL, { cache: "no-store" });
    if (res.ok) {
      const j = (await res.json()) as { reports: Array<{ binanceUserId: string }> };
      for (const r of j.reports ?? []) existingIds.add(r.binanceUserId);
      console.log(`[susqr] existing active reports: ${existingIds.size}`);
    } else {
      console.warn(
        `[susqr] could not fetch registry (${res.status}); proceeding without existing-dedupe`,
      );
    }
  } catch (e) {
    console.warn(
      `[susqr] registry fetch failed: ${e instanceof Error ? e.message : e}`,
    );
  }

  const toSubmit: Resolved[] = [];
  const alreadyInRegistry: Resolved[] = [];
  for (const r of uniqByUser.values()) {
    if (existingIds.has(r.userId!)) alreadyInRegistry.push(r);
    else toSubmit.push(r);
  }

  // 6. Write CSV preview.
  const csvPath = path.join(dir, "susqr-import-preview.csv");
  const lines: string[] = [
    "status,advertiserNo,profileUrl,isShortLink,fileCount,exampleFile,raw",
  ];
  for (const r of toSubmit) {
    lines.push(
      [
        "to_submit",
        csvCell(r.userId),
        csvCell(r.profileUrl),
        r.isShortLink ? "1" : "0",
        String(r.files.length),
        csvCell(path.basename(r.files[0] ?? "")),
        csvCell(r.raw),
      ].join(","),
    );
  }
  for (const r of alreadyInRegistry) {
    lines.push(
      [
        "already_in_registry",
        csvCell(r.userId),
        csvCell(r.profileUrl),
        r.isShortLink ? "1" : "0",
        String(r.files.length),
        csvCell(path.basename(r.files[0] ?? "")),
        csvCell(r.raw),
      ].join(","),
    );
  }
  for (const r of resolved) {
    if (r.userId) continue;
    lines.push(
      [
        "unparsed",
        "",
        "",
        "",
        String(r.files.length),
        csvCell(path.basename(r.files[0] ?? "")),
        csvCell(r.raw),
      ].join(","),
    );
  }
  for (const d of decodeFailed) {
    lines.push(
      [
        "decode_failed",
        "",
        "",
        "",
        "1",
        csvCell(path.basename(d.file)),
        csvCell(d.error ?? ""),
      ].join(","),
    );
  }
  await fs.writeFile(csvPath, lines.join("\n") + "\n", "utf8");

  console.log(`[susqr] CSV written: ${csvPath}`);
  console.log(`[susqr] ── summary ────────────────────────────`);
  console.log(`[susqr]   image files          : ${files.length}`);
  console.log(`[susqr]   decode failures      : ${decodeFailed.length}`);
  console.log(`[susqr]   unique payloads      : ${byRaw.size}`);
  console.log(
    `[susqr]   unparsed payloads    : ${resolved.filter((r) => !r.userId).length}`,
  );
  console.log(`[susqr]   unique advertiserNos : ${uniqByUser.size}`);
  console.log(`[susqr]   already in registry  : ${alreadyInRegistry.length}`);
  console.log(`[susqr]   TO SUBMIT            : ${toSubmit.length}`);
  console.log(
    `[susqr]   short-link unresolved: ${toSubmit.filter((r) => r.isShortLink).length}`,
  );
  console.log(`[susqr] ──────────────────────────────────────`);

  if (!COMMIT) {
    console.log(
      `[susqr] dry run only — re-run with --commit to POST to ${API_URL}`,
    );
    return;
  }

  // 7. Submit, throttled.
  console.log(
    `[susqr] submitting ${toSubmit.length} reports to ${API_URL} (reason="${REASON}", throttle=${THROTTLE_MS}ms)`,
  );
  let submitted = 0;
  let failed = 0;
  const failures: { userId: string; error: string }[] = [];
  for (const r of toSubmit) {
    try {
      const body = {
        // Prefer the canonical profile URL we already resolved — for
        // short-links we couldn't follow the server can still try, but
        // sending the canonical URL avoids the round-trip when we have it.
        decoded: r.profileUrl ?? r.raw,
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
          userId: r.userId!,
          error: `${res.status}: ${txt.slice(0, 200)}`,
        });
      }
    } catch (e) {
      failed++;
      failures.push({
        userId: r.userId!,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    if (
      (submitted + failed) % 20 === 0 ||
      submitted + failed === toSubmit.length
    ) {
      console.log(
        `[susqr] progress ${submitted + failed}/${toSubmit.length} (ok=${submitted} fail=${failed})`,
      );
    }
    await new Promise((res) => setTimeout(res, THROTTLE_MS));
  }
  console.log(`[susqr] done. submitted=${submitted} failed=${failed}`);
  if (failures.length) {
    const failPath = path.join(dir, "susqr-failures.csv");
    await fs.writeFile(
      failPath,
      "advertiserNo,error\n" +
        failures
          .map((f) => `${csvCell(f.userId)},${csvCell(f.error)}`)
          .join("\n") +
        "\n",
      "utf8",
    );
    console.log(`[susqr] failures written: ${failPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
