/**
 * Per-build identity for which exchange this deployment is showing.
 *
 * Set this at the top of the file (build-time constant). The same source
 * tree gets used as the basis for both deployments — the Binance fork
 * flips `ACTIVE_EXCHANGE` to `"binance"` and updates the data layer; this
 * (Bybit) build keeps it as `"bybit"`.
 *
 * Surfaced via the topbar's <ExchangeSwitch /> tab so users can hop to the
 * sister deployment.
 */
export type ExchangeId = "binance" | "bybit";

export const ACTIVE_EXCHANGE: ExchangeId = "bybit";

/**
 * URL of the *other* deployment — the one this build is NOT showing.
 *
 * Reads from `NEXT_PUBLIC_OTHER_EXCHANGE_URL` so it can be set per-environment
 * without code changes. Leave unset and the switcher hides itself rather than
 * shipping a dead link.
 */
export const OTHER_EXCHANGE_URL: string | undefined =
  process.env.NEXT_PUBLIC_OTHER_EXCHANGE_URL;

export const ACTIVE_EXCHANGE_LABEL: Record<ExchangeId, string> = {
  binance: "Binance",
  bybit: "Bybit",
};
