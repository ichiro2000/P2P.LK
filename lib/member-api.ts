import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/guard";
import { LimitError } from "@/lib/member-data";
import { ALERT_TYPES, USER_ITEM_KINDS, type AlertType, type UserItemKind } from "@/lib/db/schema";
import { EXCHANGE_IDS, type ExchangeId } from "@/lib/exchanges/types";

/**
 * Shared pieces for /api/me/*: zod shapes for member data, item-key
 * derivation, and the response helpers (always no-store — this is private,
 * per-user data).
 */

export const NO_STORE = { "Cache-Control": "private, no-store" };

export function ok<T>(body: T, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/** LimitError → 409, anything else → 500. */
export function memberError(err: unknown) {
  if (err instanceof LimitError) return jsonError(409, err.message, { limit: true });
  console.error("[api/me]", err);
  return jsonError(500, "Something went wrong.");
}

/* ── Item payloads ────────────────────────────────────────────────────── */

const zCode = (min: number, max: number) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .regex(new RegExp(`^[A-Z0-9]{${min},${max}}$`), "invalid code");

export const zExchange = z.enum(EXCHANGE_IDS);
const zMerchantId = z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/, "invalid merchant id");
const zName = z.string().trim().min(1).max(80);

export const MarketData = z.object({ asset: zCode(2, 10), fiat: zCode(3, 3) });

export const MerchantData = z.object({
  exchange: zExchange,
  id: zMerchantId,
  name: zName,
  asset: zCode(2, 10).optional(),
  fiat: zCode(3, 3).optional(),
});

export const BlockedData = MerchantData.extend({
  reason: z.string().trim().max(200).optional(),
});

/** Internal paths only ("/x", never "//host" or a scheme). */
const zPath = z
  .string()
  .trim()
  .max(100)
  .regex(/^\/(?!\/)[A-Za-z0-9/_-]*$/, "must be an internal path");

export const FilterData = z.object({
  label: zName,
  path: zPath,
  search: z
    .string()
    .trim()
    .max(500)
    .transform((s) => s.replace(/^\?/, "")),
});

export const zFilterKey = z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/, "invalid key");

/** POST /api/me/items body. Keys are derived on the server for markets and
 *  merchants so one market/merchant can never be stored twice. */
export const ItemBody = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("market"), data: MarketData }),
  z.object({ kind: z.literal("merchant"), data: MerchantData }),
  z.object({ kind: z.literal("blocked_merchant"), data: BlockedData }),
  z.object({ kind: z.literal("filter"), itemKey: zFilterKey.optional(), data: FilterData }),
]);
export type ItemBody = z.infer<typeof ItemBody>;

export const zKind = z.enum(USER_ITEM_KINDS);

export function marketKey(d: { asset: string; fiat: string }) {
  return `${d.asset}/${d.fiat}`;
}
export function merchantKey(d: { exchange: ExchangeId; id: string }) {
  return `${d.exchange}:${d.id}`;
}

export function itemKeyFor(body: ItemBody): string {
  switch (body.kind) {
    case "market":
      return marketKey(body.data);
    case "merchant":
    case "blocked_merchant":
      return merchantKey(body.data);
    case "filter":
      return body.itemKey ?? crypto.randomUUID();
  }
}

/** Strip undefined so the JSON column stays tidy. */
export function cleanData(d: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined && v !== ""));
}

/* ── Alert rules ──────────────────────────────────────────────────────── */

/** Upper bound for a threshold, by unit. Fractions are 0..1 (1 = 100%). */
const THRESHOLD_MAX: Record<AlertType, number> = {
  priceAbove: 100_000,
  priceBelow: 100_000,
  spreadAbove: 1,
  spreadBelow: 1,
  depthBelow: 1_000_000_000,
  askDepthBelow: 1_000_000_000,
  bidDepthBelow: 1_000_000_000,
  offMarketAd: 1,
  usdGoogleUp: 0.1,
  usdGoogleDown: 0.1,
  usdCbslUp: 0.1,
  usdCbslDown: 0.1,
};

export const zCooldown = z.number().int().min(60).max(86_400);
export const zLabel = z.string().trim().max(80).nullish();

export const RuleCreate = z
  .object({
    exchange: zExchange,
    type: z.enum(ALERT_TYPES),
    threshold: z.number().finite().positive(),
    label: zLabel,
    enabled: z.boolean().optional(),
    email: z.boolean().optional(),
    cooldownSec: zCooldown.optional(),
  })
  .refine((r) => r.threshold <= THRESHOLD_MAX[r.type], {
    path: ["threshold"],
    message: "is too large for this rule type",
  });

export const RulePatch = z
  .object({
    exchange: zExchange.optional(),
    threshold: z.number().finite().positive().optional(),
    label: zLabel,
    enabled: z.boolean().optional(),
    email: z.boolean().optional(),
    cooldownSec: zCooldown.optional(),
  })
  .refine((p) => Object.values(p).some((v) => v !== undefined), { message: "nothing to update" });

export function thresholdOk(type: AlertType, threshold: number) {
  return threshold > 0 && threshold <= THRESHOLD_MAX[type];
}

export type { UserItemKind };

/*
 * Rate limits: reads use RL_READ scope "me"; member writes (stars, toggles)
 * use RL_READ scope "me-write" because RL_WRITE (10/min, shared with public
 * forms) is too tight for normal clicking. Writes are already signed-in,
 * approved and capped by LIMITS. The import uses RL_WRITE.
 */
