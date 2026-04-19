/**
 * CLI ingest runner.
 *
 *   npm run ingest               # one capture for all DEFAULT_ARB_FIATS
 *   npm run ingest -- USDT:LKR   # one-off single market
 *   npm run ingest -- --loop     # run forever (used by the DO worker component)
 *   npm run ingest -- --loop --every=300  # run every N seconds
 *
 * Loads .env.local / .env automatically so DATABASE_URL is available without
 * the caller exporting it to the shell.
 */
import "dotenv/config";
import { config as loadEnv } from "dotenv";
import path from "node:path";

// dotenv/config loads .env by default. Also try .env.local for Next.js parity.
loadEnv({ path: path.resolve(process.cwd(), ".env.local"), override: false });

import { runIngest, type IngestMarket } from "../lib/ingest";
import { runTakerPoll } from "../lib/ingest-takers";

function parseArgs(argv: string[]) {
  const markets: IngestMarket[] = [];
  let loop = false;
  let everyMs = 60_000;

  for (const arg of argv) {
    if (arg === "--loop") loop = true;
    else if (arg.startsWith("--every=")) {
      const n = Number(arg.slice("--every=".length));
      if (Number.isFinite(n) && n > 0) everyMs = n * 1000;
    } else if (arg.includes(":")) {
      const [asset, fiat] = arg.split(":");
      if (asset && fiat) markets.push({ asset: asset.toUpperCase(), fiat: fiat.toUpperCase() });
    }
  }

  return { markets: markets.length ? markets : undefined, loop, everyMs };
}

async function once(markets?: IngestMarket[]) {
  const report = await runIngest(markets);
  const { marketsSucceeded, marketsAttempted, marketRowsInserted, merchantRowsInserted, durationMs, errors } = report;
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  const errStr = errors.length ? ` errors=${errors.length}` : "";
  console.log(
    `[${stamp}] ingest ok — markets=${marketsSucceeded}/${marketsAttempted} rows=${marketRowsInserted}+${merchantRowsInserted} in ${durationMs}ms${errStr}`,
  );
  if (errors.length) {
    for (const e of errors) console.error(`  ✗ ${e.market}: ${e.error}`);
  }

  // Second phase — poll every flagged taker's Binance profile. Isolated
  // from the market ingest above so a failure here doesn't mark the
  // whole tick as bad. Rows land in merchant_snapshots so the suspicious
  // detail page's "still trading?" deltas fill in automatically.
  try {
    const takerReport = await runTakerPoll();
    if (takerReport.takersAttempted > 0) {
      const errStr2 = takerReport.errors.length
        ? ` errors=${takerReport.errors.length}`
        : "";
      console.log(
        `[${stamp}] takers ok — profiled=${takerReport.takersSucceeded}/${takerReport.takersAttempted} rows=${takerReport.takerRowsInserted} in ${takerReport.durationMs}ms${errStr2}`,
      );
      if (takerReport.errors.length) {
        for (const e of takerReport.errors.slice(0, 5)) {
          console.error(`  ✗ taker ${e.takerId}: ${e.error}`);
        }
      }
    }
  } catch (err) {
    console.error(
      `[${stamp}] taker poll failed:`,
      err instanceof Error ? err.message : err,
    );
  }
}

async function main() {
  const { markets, loop, everyMs } = parseArgs(process.argv.slice(2));

  if (!loop) {
    await once(markets);
    process.exit(0);
  }

  console.log(`[ingest] running every ${everyMs / 1000}s. Ctrl-C to stop.`);
  let stopping = false;
  const onSig = () => {
    if (stopping) process.exit(0);
    stopping = true;
    console.log("\n[ingest] shutting down…");
    process.exit(0);
  };
  process.on("SIGINT", onSig);
  process.on("SIGTERM", onSig);

  // Fire immediately so you don't wait for the first tick.
  await once(markets);
  while (!stopping) {
    await new Promise((r) => setTimeout(r, everyMs));
    if (stopping) break;
    try {
      await once(markets);
    } catch (err) {
      console.error("[ingest] tick failed:", err);
    }
  }
}

main().catch((err) => {
  console.error("[ingest] fatal:", err);
  process.exit(1);
});
