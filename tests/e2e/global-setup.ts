import { clearRateLimits, purgeE2eData, resetFlags } from "./support/db";

/** Leftovers from an aborted run go first; sign-up/sign-in counters reset. */
export default async function globalSetup() {
  purgeE2eData();
  resetFlags();
  clearRateLimits();
}
