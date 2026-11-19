/**
 * Maker spread capture (D5). Pure and client-safe.
 *
 * A merchant quotes both sides on one exchange: a Buy ad at `bid` (they
 * buy USDT from takers, paying LKR) and a Sell ad at `ask` (they sell USDT
 * to takers, receiving LKR). One cycle = `capital` LKR goes out through
 * the Buy ad and comes back through the Sell ad.
 *
 * Maker fees are charged by the exchange on each filled ad, in USDT, as a
 * fraction of the order (0.001 = 0.1 %). P2P takers on Binance / Bybit
 * usually pay no trading fee; makers (advertisers) may.
 *
 *   usdtIn   = capital / bid × (1 − feeBuy)
 *   lkrBack  = usdtIn × (1 − feeSell) × ask
 *   net      = lkrBack − capital
 *   break-even ask  = bid / ((1 − feeBuy)(1 − feeSell))
 *
 * Price risk: the second leg can wait for a taker (and a 15-minute payment
 * window). If the market moves by `riskBand` against you in that time you
 * must reprice the open leg to get it filled: the sell down to ask·(1−r)
 * if the buy filled first, or the buy up to bid·(1+r) if the sell filled
 * first. The downside line is the worse of the two.
 */

export type MakerInputs = {
  /** Price on your Buy ad (what you pay per USDT). */
  bid: number;
  /** Price on your Sell ad (what you receive per USDT). */
  ask: number;
  /** LKR per cycle. */
  capital: number;
  /** Maker fee on your Buy ad, fraction. */
  feeBuy: number;
  /** Maker fee on your Sell ad, fraction. */
  feeSell: number;
  cyclesPerDay: number;
  /** Adverse price move during the payment window, fraction (0.002 = 0.2 %). */
  riskBand: number;
};

export type MakerResult = {
  /** ask − bid, LKR per USDT. */
  grossPerUsdt: number;
  /** grossPerUsdt / bid. */
  grossPct: number;
  /** USDT bought per cycle, before fees. */
  usdtPerCycle: number;
  /** Gross LKR per cycle (no fees). */
  grossPerCycle: number;
  /** LKR lost to maker fees per cycle. */
  feesPerCycle: number;
  /** Net LKR per cycle after fees. */
  netPerCycle: number;
  /** netPerCycle / capital. */
  netPct: number;
  /** Net per USDT bought. */
  netPerUsdt: number;
  /** Ask needed to break even at this bid. */
  breakEvenAsk: number;
  /** breakEvenAsk − bid, LKR per USDT. */
  breakEvenSpread: number;
  /** breakEvenSpread / bid. */
  breakEvenPct: number;
  /** Net per cycle if the price moves `riskBand` against you before the second leg fills. */
  downsidePerCycle: number;
  /** Which leg reprices in the downside case. */
  downsideLeg: "sell" | "buy";
  /** Adverse move (fraction) that wipes out the net. Null if the spread is already negative. */
  breakEvenMove: number | null;
  perDay: number;
  downsidePerDay: number;
};

/** Net LKR for one cycle at these prices and fees. */
export function makerNet(capital: number, bid: number, ask: number, feeBuy: number, feeSell: number): number {
  if (!(capital > 0) || !(bid > 0) || !(ask > 0)) return 0;
  const usdtIn = (capital / bid) * (1 - feeBuy);
  return usdtIn * (1 - feeSell) * ask - capital;
}

/** Ask at which a cycle nets exactly zero. */
export function breakEvenAsk(bid: number, feeBuy: number, feeSell: number): number {
  return bid / ((1 - feeBuy) * (1 - feeSell));
}

export function makerCycle(i: MakerInputs): MakerResult | null {
  const { bid, ask, capital, feeBuy, feeSell, riskBand } = i;
  if (!(bid > 0) || !(ask > 0) || !(capital > 0)) return null;
  if (!(feeBuy >= 0 && feeBuy < 1) || !(feeSell >= 0 && feeSell < 1)) return null;
  const r = Math.max(0, riskBand || 0);
  const cycles = Math.max(0, i.cyclesPerDay || 0);

  const usdt = capital / bid;
  const grossPerUsdt = ask - bid;
  const grossPerCycle = usdt * grossPerUsdt;
  const netPerCycle = makerNet(capital, bid, ask, feeBuy, feeSell);
  const beAsk = breakEvenAsk(bid, feeBuy, feeSell);

  // Buy leg filled first → sell reprices down; sell first → buy reprices up.
  const sellDown = makerNet(capital, bid, ask * (1 - r), feeBuy, feeSell);
  const buyUp = makerNet(capital, bid * (1 + r), ask, feeBuy, feeSell);
  const downside = Math.min(sellDown, buyUp);
  const downsideLeg = sellDown <= buyUp ? "sell" : "buy";

  // Move m on the sell leg that zeroes the net: ask·(1−m) = breakEvenAsk.
  const breakEvenMove = ask > beAsk ? 1 - beAsk / ask : null;

  return {
    grossPerUsdt,
    grossPct: grossPerUsdt / bid,
    usdtPerCycle: usdt,
    grossPerCycle,
    feesPerCycle: grossPerCycle - netPerCycle,
    netPerCycle,
    netPct: netPerCycle / capital,
    netPerUsdt: netPerCycle / usdt,
    breakEvenAsk: beAsk,
    breakEvenSpread: beAsk - bid,
    breakEvenPct: (beAsk - bid) / bid,
    downsidePerCycle: downside,
    downsideLeg,
    breakEvenMove,
    perDay: netPerCycle * cycles,
    downsidePerDay: downside * cycles,
  };
}
