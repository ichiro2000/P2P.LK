import "server-only";
import { getDb } from "@/lib/db/client";
import { STALE_AFTER_SEC } from "@/lib/db/queries";
import { p2pDaily } from "@/lib/fx/queries";
import { addDays, sltDate } from "@/lib/fx/http";
import { EXCHANGE_IDS, type ExchangeId } from "@/lib/exchanges";
import { loadCbsl, loadGoogle, loadMids } from "@/lib/dollar-data";
import {
  CBSL_CORR_DAYS,
  CBSL_MIN_DAYS,
  CBSL_STALE_DAYS,
  GOOGLE_CORR_DAYS,
  GOOGLE_MIN_PAIRS,
  GOOGLE_STALE_SEC,
  WINDOWS,
  cbslDayChange,
  cbslPairs,
  dayTs,
  googleChange,
  googlePairs,
  indexedSeries,
  lagGap,
  link,
  midAt,
  midChange,
  type Change,
  type FxPoint,
  type IndexedPoint,
  type Lag,
  type Link,
  type WindowKey,
} from "@/lib/dollar-signals";
import { USD_SIGNAL, cbslSignal, usdSignal, type CbslSignal, type UsdSignal } from "@/lib/risk-signals";

/**
 * "Dollar rate vs USDT" for the risk page: Google USD/LKR (30-min) and CBSL
 * indicative (daily) against the USDT/LKR P2P mid of each exchange.
 * Everything is measured from our own stored history; see lib/dollar-signals.
 *
 * Reads: Google readings (8 days), USDT 5-min mids for both exchanges
 * (8 days, one GROUP BY), CBSL days (90 + a few) and USDT daily averages.
 */

export type DollarExchangeView = {
  exchange: ExchangeId;
  usdt: { mid: number | null; ts: number | null; stale: boolean };
  /** USDT change between the SAME two Google readings as each window. */
  changes: Record<WindowKey, Change | null>;
  /** USDT daily-average change between the two CBSL days. */
  cbslDay: Change | null;
  googleLink: Link;
  cbslLink: Link;
  /** 2 h: expected (beta × Google move) vs USDT's move from the window start to now. */
  lag: (Lag & { since: Change }) | null;
  signal: UsdSignal | null;
};

export type DollarReport = {
  nowTs: number;
  google: { latest: FxPoint | null; ageSec: number | null; stale: boolean };
  googleChanges: Record<WindowKey, Change | null>;
  cbsl: { change: (Change & { day: string; prevDay: string }) | null; stale: boolean };
  cbslSignal: CbslSignal | null;
  exchanges: Record<ExchangeId, DollarExchangeView>;
  chart: { "24h": IndexedPoint[]; "7d": IndexedPoint[] };
};

export async function computeDollarReport(nowTs = Math.floor(Date.now() / 1000)): Promise<DollarReport> {
  const db = await getDb();
  const today = sltDate(new Date(nowTs * 1000));
  // 7 days of correlation + the 24 h window start before it.
  const since = nowTs - (GOOGLE_CORR_DAYS + 1) * 86400;
  const cbslSince = addDays(today, -(CBSL_CORR_DAYS + 7));
  const [google, mids, cbsl, daily] = await Promise.all([
    loadGoogle(db, since),
    loadMids(db, EXCHANGE_IDS, since),
    loadCbsl(db, cbslSince),
    p2pDaily(cbslSince),
  ]);

  const latest = google[google.length - 1] ?? null;
  const ageSec = latest ? Math.max(0, nowTs - latest.ts) : null;
  const googleStale = ageSec == null || ageSec > GOOGLE_STALE_SEC;
  const googleChanges = Object.fromEntries(WINDOWS.map((w) => [w.key, googleChange(google, w.sec)])) as Record<
    WindowKey,
    Change | null
  >;
  const move2h = googleChanges["2h"];

  const cbslChange = cbslDayChange(cbsl);
  const cbslStale = !cbslChange || dayTs(today) - dayTs(cbslChange.day) > CBSL_STALE_DAYS * 86400;
  const corrSinceTs = nowTs - GOOGLE_CORR_DAYS * 86400;
  const corrSinceDay = addDays(today, -CBSL_CORR_DAYS);

  const view = (ex: ExchangeId): DollarExchangeView => {
    const m = mids[ex];
    const last = m[m.length - 1];
    const usdtStale = !last || nowTs - last.ts > STALE_AFTER_SEC;
    const usdtNow = usdtStale ? null : midAt(m, nowTs);
    const changes = Object.fromEntries(
      WINDOWS.map((w) => {
        const g = googleChanges[w.key];
        return [w.key, g ? midChange(m, g.fromTs, g.toTs) : null];
      }),
    ) as Record<WindowKey, Change | null>;
    const usdtDaily = new Map(daily.filter((d) => d.exchange === ex && d.mid != null).map((d) => [d.day, d.mid as number]));
    const cbslDay = (() => {
      if (!cbslChange) return null;
      const a = usdtDaily.get(cbslChange.prevDay);
      const b = usdtDaily.get(cbslChange.day);
      return a != null && b != null
        ? { from: a, to: b, fromTs: cbslChange.fromTs, toTs: cbslChange.toTs, abs: b - a, pct: b / a - 1 }
        : null;
    })();
    // Beta from the 7 days BEFORE the current 2 h window (see googlePairs).
    const googleLink = link(googlePairs(google, m, corrSinceTs, move2h?.fromTs ?? Infinity), GOOGLE_MIN_PAIRS);
    const cbslLink = link(cbslPairs(cbsl, usdtDaily, corrSinceDay), CBSL_MIN_DAYS);

    const startMid = move2h ? midAt(m, move2h.fromTs) : null;
    const since: Change | null =
      move2h && startMid != null && usdtNow != null
        ? { from: startMid, to: usdtNow, fromTs: move2h.fromTs, toTs: nowTs, abs: usdtNow - startMid, pct: usdtNow / startMid - 1 }
        : null;
    const lag = move2h && since ? { ...lagGap(move2h.pct, since.pct, googleLink, USD_SIGNAL.lagShare), since } : null;
    const signal = usdSignal({ move: move2h, googleStale, usdtStale, usdtSince: since?.pct ?? null, link: googleLink });
    return {
      exchange: ex,
      usdt: { mid: usdtNow, ts: last?.ts ?? null, stale: usdtStale },
      changes,
      cbslDay,
      googleLink,
      cbslLink,
      lag,
      signal,
    };
  };

  const exchanges = Object.fromEntries(EXCHANGE_IDS.map((e) => [e, view(e)])) as Record<ExchangeId, DollarExchangeView>;
  return {
    nowTs,
    google: { latest, ageSec, stale: googleStale },
    googleChanges,
    cbsl: { change: cbslChange, stale: cbslStale },
    cbslSignal: cbslSignal(cbslChange, today),
    exchanges,
    chart: {
      "24h": indexedSeries(google, mids, nowTs, 86400, 1800),
      "7d": indexedSeries(google, mids, nowTs, 7 * 86400, 3600),
    },
  };
}
