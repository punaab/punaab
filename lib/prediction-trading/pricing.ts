import { PREDICTION_PRICE_SCALE, PREDICTION_TRADING_LIMITS } from "../config";

/** Jupiter docs: micro USD where 1_000_000 = $1.00 */
export function microToDollars(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "string") {
    try {
      const bi = BigInt(v);
      return Number(bi) / PREDICTION_PRICE_SCALE;
    } catch {
      const n = Number(v);
      return Number.isFinite(n) ? normalizePriceNumber(n) : 0;
    }
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return normalizePriceNumber(v);
  }
  return 0;
}

/**
 * API usually returns micro-USD (650000 = $0.65). Some payloads already use dollars.
 * Heuristic: values in (0, 2] look like dollars; larger ints look like micro.
 */
function normalizePriceNumber(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n > 0 && n <= 2) return n;
  return n / PREDICTION_PRICE_SCALE;
}

export type OrderbookLevel = { priceUsd: number; quantity: number };

export type PriceSource = "market_buy" | "bid_proxy" | "none";

/** Parse [[price_cents, qty], ...] or [["0.01", qty], ...] bid arrays. */
export function parseOrderbookSide(raw: unknown): OrderbookLevel[] {
  if (!Array.isArray(raw)) return [];
  const levels: OrderbookLevel[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const [priceRaw, qtyRaw] = row;
    let priceUsd = 0;
    if (typeof priceRaw === "string" && priceRaw.includes(".")) {
      priceUsd = Number(priceRaw);
    } else {
      const cents = Number(priceRaw);
      priceUsd = Number.isFinite(cents) ? cents / 100 : 0;
    }
    const quantity = Number(qtyRaw);
    if (priceUsd > 0 && Number.isFinite(quantity)) {
      levels.push({ priceUsd, quantity });
    }
  }
  return levels;
}

/** Best bid (highest price in ascending-sorted bid book) — sell-side estimate. */
export function bestBid(levels: OrderbookLevel[]): number {
  if (!levels.length) return 0;
  return levels[levels.length - 1]?.priceUsd ?? 0;
}

/**
 * @deprecated Do NOT use for buy decisions — orderbook arrays are BIDS.
 * Lowest bid is often a $0.01 stub, not an executable ask.
 */
export function cheapestLevel(levels: OrderbookLevel[]): number {
  if (!levels.length) return 0;
  return levels[0]?.priceUsd ?? 0;
}

/** Min credible buy price — rejects orderbook floor stubs ($0.01). */
export function minExecutableBuyPrice(): number {
  return Number(process.env.PREDICTION_MIN_BUY_PRICE ?? "0.04");
}

/** Max single-side buy before we treat it as near-certain (no arb room). */
export function maxExecutableBuyPrice(): number {
  return 0.96;
}

/**
 * Executable buy price must come from market buy* fields, not lowest bid.
 * Forecast: each BISON side is bought with isYes=true → use that market's buyYesPriceUsd.
 */
export function isExecutableBuyPrice(price: number | undefined | null): boolean {
  if (price == null || !Number.isFinite(price)) return false;
  const min = minExecutableBuyPrice();
  return price >= min && price <= maxExecutableBuyPrice();
}

export function resolveMarketBuyPrice(params: {
  buyYesPriceUsd?: number | null;
  buyNoPriceUsd?: number | null;
  /** For Forecast outcome markets, always prefer buyYes (isYes:true path). */
  forecastSide?: boolean;
}): { price: number; source: PriceSource } {
  if (params.forecastSide) {
    if (isExecutableBuyPrice(params.buyYesPriceUsd)) {
      return { price: params.buyYesPriceUsd!, source: "market_buy" };
    }
    return { price: 0, source: "none" };
  }
  if (isExecutableBuyPrice(params.buyYesPriceUsd)) {
    return { price: params.buyYesPriceUsd!, source: "market_buy" };
  }
  if (isExecutableBuyPrice(params.buyNoPriceUsd)) {
    return { price: params.buyNoPriceUsd!, source: "market_buy" };
  }
  return { price: 0, source: "none" };
}

/**
 * Forecast UP+DOWN pair sanity for temporal arb.
 * Rejects stub legs and "too good to be true" combined books that usually mean bad data.
 */
export function validateForecastBuyPair(
  upBuy: number,
  downBuy: number,
): { ok: boolean; combined: number; edgeBps: number; reason?: string } {
  const combined = upBuy + downBuy;
  const edgeBps = combined > 0 ? Math.round((1 - combined) * 10_000) : 0;

  if (!isExecutableBuyPrice(upBuy)) {
    return { ok: false, combined, edgeBps, reason: "up_price_not_executable" };
  }
  if (!isExecutableBuyPrice(downBuy)) {
    return { ok: false, combined, edgeBps, reason: "down_price_not_executable" };
  }

  // Extreme under-$1 with a near-floor leg is almost always bid-stub contamination
  const minLeg = Math.min(upBuy, downBuy);
  if (combined < 0.82 && minLeg < 0.08) {
    return { ok: false, combined, edgeBps, reason: "suspicious_stub_pair" };
  }

  // Crossed / inverted book — not a buy-both arb
  if (combined > 1.02) {
    return { ok: false, combined, edgeBps, reason: "no_arb_combined_gt_1" };
  }

  const minEdge = PREDICTION_TRADING_LIMITS.minCombinedEdgeBps;
  if (edgeBps < minEdge) {
    return { ok: false, combined, edgeBps, reason: "edge_below_min" };
  }

  return { ok: true, combined, edgeBps };
}

/** Binary (non-Forecast) YES+NO buy pair check. */
export function validateBinaryBuyPair(
  yesBuy: number,
  noBuy: number,
): { ok: boolean; combined: number; edgeBps: number; reason?: string } {
  return validateForecastBuyPair(yesBuy, noBuy);
}

/** Mid probability from buy prices (and optional sells). */
export function midProbFromBuys(
  yesBuy: number,
  noBuy: number,
  yesSell?: number,
  noSell?: number,
): number {
  let yes = yesBuy;
  let no = noBuy;
  if (
    yesSell != null &&
    yesSell > 0 &&
    noSell != null &&
    noSell > 0
  ) {
    yes = (yesBuy + yesSell) / 2;
    no = (noBuy + noSell) / 2;
  }
  if (yes <= 0 && no <= 0) return 0.5;
  if (yes > 0 && no > 0) return yes / (yes + no);
  return yes > 0 ? yes : 1 - no;
}

/** Max adverse move (fraction) allowed between signal and live reprice. */
export function maxAdverseSlippage(): number {
  return Number(process.env.PREDICTION_MAX_ADVERSE_SLIP ?? "0.03");
}

export function priceMovedAgainstBuy(
  signaled: number,
  live: number,
  maxAdverse = maxAdverseSlippage(),
): boolean {
  if (!isExecutableBuyPrice(live)) return true;
  return live > signaled + maxAdverse;
}
