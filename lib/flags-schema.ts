import { z } from "zod";

/** Flag shape, defaults and limits. Client-safe (no bindings imported), so
 *  the admin UI can share them; lib/flags.ts does the KV reads/writes. */

export const FLAGS_KEY = "flags:v1";
export const BANNER_MAX = 280;

export const FlagsSchema = z.object({
  /** New accounts can sign up. Off → the sign-up hook refuses politely. */
  signupsOpen: z.boolean(),
  /** Alert emails. Off → the cron still records alert events, sends no mail. */
  alertEmails: z.boolean(),
  /** FX rates collector in the cron. Off → the 3-hourly run is skipped. */
  fxCollector: z.boolean(),
  /** Site-wide text banner; empty = none. */
  banner: z.string().trim().max(BANNER_MAX),
});
export type Flags = z.infer<typeof FlagsSchema>;

export const DEFAULT_FLAGS: Flags = {
  signupsOpen: true,
  alertEmails: true,
  fxCollector: true,
  banner: "",
};
