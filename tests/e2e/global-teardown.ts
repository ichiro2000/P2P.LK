import fs from "node:fs";
import path from "node:path";
import { clearRateLimits, purgeE2eData, purgeE2eMail, purgePushSink, resetFlags } from "./support/db";

/** Leaves local D1/KV as found: no `@e2e.test` users, mail or audit rows,
 *  flags at defaults, rate-limit counters cleared. */
export default async function globalTeardown() {
  purgeE2eData();
  purgeE2eMail();
  purgePushSink();
  resetFlags();
  clearRateLimits();
  fs.rmSync(path.resolve(__dirname, ".auth"), { recursive: true, force: true });
}
