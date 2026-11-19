import type { NextRequest } from "next/server";
import { z } from "zod";
import { memberFromRequest } from "@/lib/auth/session";
import { jsonError, rateLimit, readBodyText, validate } from "@/lib/guard";
import { LIMITS, LimitError, createRule, listItems, listRules, upsertItem } from "@/lib/member-data";
import {
  FilterData,
  MarketData,
  MerchantData,
  cleanData,
  marketKey,
  memberError,
  merchantKey,
  ok,
  thresholdOk,
  zCooldown,
  zExchange,
  zFilterKey,
} from "@/lib/member-api";
import { ALERT_TYPES, type UserItemKind } from "@/lib/db/schema";
import { ASSET, FIAT } from "@/lib/constants";

export const dynamic = "force-dynamic";

/**
 * POST /api/me/import — one-time copy of a guest's localStorage workspace
 * (watchlist, favourite merchants, saved filters, alert rules) into the DB.
 *
 * Idempotent: markets/merchants are keyed by identity, filters by their
 * local id, and a rule identical to an existing one (exchange, type,
 * threshold) is skipped. Invalid entries are skipped one by one; LIMITS are
 * respected (anything over is counted in `skipped`).
 *
 * Reads its own body because a full workspace can exceed readJson's 16 KB.
 */

const MAX_BODY = 128 * 1024;

// Entries are parsed one by one below, so the top level only checks shape.
const Body = z.object({
  markets: z.array(z.unknown()).max(200).default([]),
  merchants: z.array(z.unknown()).max(1000).default([]),
  filters: z.array(z.unknown()).max(200).default([]),
  rules: z.array(z.unknown()).max(200).default([]),
});

/** Old guest data has no exchange: the site was Binance-only then. */
const GuestMerchant = MerchantData.extend({ exchange: zExchange.default("binance") });
const GuestFilter = FilterData.extend({ id: zFilterKey });
const GuestRule = z.object({
  type: z.enum(ALERT_TYPES),
  threshold: z.number().finite().positive(),
  exchange: zExchange.default("binance"),
  label: z.string().trim().max(80).nullish(),
  enabled: z.boolean().default(true),
  cooldownSec: z.number().int().catch(1800).transform((n) => Math.min(86_400, Math.max(60, n))).pipe(zCooldown),
});

type Tally = { imported: number; existing: number; skipped: number; invalid: number };
const tally = (): Tally => ({ imported: 0, existing: 0, skipped: 0, invalid: 0 });

export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, "write", "me-import");
  if (limited) return limited;
  const m = await memberFromRequest(req);
  if (!m.ok) return m.res;

  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return jsonError(415, "Expected an application/json body.");
  }
  // Bounded read: a chunked body has no Content-Length to check up front.
  const text = await readBodyText(req, MAX_BODY);
  if (text === null) return jsonError(413, "Request body too large.");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return jsonError(400, "Invalid JSON body.");
  }
  const body = validate(Body, raw);
  if (!body.ok) return body.res;

  const userId = m.viewer.id;
  const result = { markets: tally(), merchants: tally(), filters: tally(), rules: tally() };

  try {
    const existing = await listItems(userId);
    const keys = new Set(existing.map((i) => `${i.kind}|${i.itemKey}`));
    const counts: Record<UserItemKind, number> = { market: 0, merchant: 0, blocked_merchant: 0, filter: 0 };
    for (const i of existing) counts[i.kind] += 1;

    async function put(t: Tally, kind: UserItemKind, itemKey: string, data: Record<string, unknown>) {
      if (keys.has(`${kind}|${itemKey}`)) {
        t.existing += 1;
        return;
      }
      if (counts[kind] >= LIMITS.items[kind]) {
        t.skipped += 1;
        return;
      }
      try {
        await upsertItem(userId, kind, itemKey, data);
      } catch (err) {
        if (err instanceof LimitError) {
          t.skipped += 1;
          return;
        }
        throw err;
      }
      keys.add(`${kind}|${itemKey}`);
      counts[kind] += 1;
      t.imported += 1;
    }

    for (const rawM of body.data.markets) {
      const p = MarketData.safeParse(rawM);
      if (!p.success) result.markets.invalid += 1;
      else await put(result.markets, "market", marketKey(p.data), cleanData(p.data));
    }
    for (const rawM of body.data.merchants) {
      const p = GuestMerchant.safeParse(rawM);
      if (!p.success) result.merchants.invalid += 1;
      else await put(result.merchants, "merchant", merchantKey(p.data), cleanData(p.data));
    }
    for (const rawF of body.data.filters) {
      const p = GuestFilter.safeParse(rawF);
      if (!p.success) result.filters.invalid += 1;
      else {
        const { id, ...data } = p.data;
        await put(result.filters, "filter", id, cleanData(data));
      }
    }

    const rules = await listRules(userId);
    const sig = (r: { exchange: string; type: string; threshold: number }) =>
      `${r.exchange}|${r.type}|${Number(r.threshold.toPrecision(10))}`;
    const ruleSigs = new Set(rules.map(sig));
    let ruleCount = rules.length;
    for (const rawR of body.data.rules) {
      const p = GuestRule.safeParse(rawR);
      if (!p.success || !thresholdOk(p.data.type, p.data.threshold)) {
        result.rules.invalid += 1;
        continue;
      }
      if (ruleSigs.has(sig(p.data))) {
        result.rules.existing += 1;
        continue;
      }
      if (ruleCount >= LIMITS.rules) {
        result.rules.skipped += 1;
        continue;
      }
      await createRule(userId, {
        exchange: p.data.exchange,
        type: p.data.type,
        asset: ASSET,
        fiat: FIAT.code,
        threshold: p.data.threshold,
        label: p.data.label ?? null,
        enabled: p.data.enabled,
        // Guest rules were in-app only; email stays off until the member opts in.
        email: false,
        cooldownSec: p.data.cooldownSec,
      });
      ruleSigs.add(sig(p.data));
      ruleCount += 1;
      result.rules.imported += 1;
    }

    const imported = Object.values(result).reduce((s, t) => s + t.imported, 0);
    return ok({ imported, result });
  } catch (err) {
    return memberError(err);
  }
}
