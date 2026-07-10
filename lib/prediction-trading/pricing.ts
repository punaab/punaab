import { PREDICTION_PRICE_SCALE } from "../config";

/** Jupiter docs: micro USD where 1_000_000 = $1.00 */
export function microToDollars(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "string") {
    try {
      const bi = BigInt(v);
      return Number(bi) / PREDICTION_PRICE_SCALE;
    } catch {
      const n = Number(v);
      return Number.isFinite(n) ? n / PREDICTION_PRICE_SCALE : 0;
    }
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return v / PREDICTION_PRICE_SCALE;
  }
  return 0;
}

export type OrderbookLevel = { priceUsd: number; quantity: number };

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

/** Best bid (highest price in ascending-sorted bid book). */
export function bestBid(levels: OrderbookLevel[]): number {
  if (!levels.length) return 0;
  return levels[levels.length - 1]?.priceUsd ?? 0;
}

/** Cheapest level to buy (lowest non-zero ask proxy from bid side — use market pricing for buys). */
export function cheapestLevel(levels: OrderbookLevel[]): number {
  if (!levels.length) return 0;
  return levels[0]?.priceUsd ?? 0;
}
