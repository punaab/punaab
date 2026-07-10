import type { PredictionOrderbook } from "./types";
import { midProbFromBuys } from "./pricing";

/** Rough fair P(YES/Up) from executable buy prices + time decay. */
export function estimateFairProbYes(params: {
  orderbook: PredictionOrderbook;
  secondsToClose: number;
  windowSeconds?: number;
  /** Prefer mid from buy/sell when provided by scanner */
  overrideFair?: number;
}): number {
  const { orderbook, secondsToClose } = params;
  const windowSeconds = params.windowSeconds ?? 900;

  const yes = orderbook.yesDollars;
  const no = orderbook.noDollars;
  if (yes <= 0 && no <= 0) return 0.5;

  const mid =
    params.overrideFair != null && Number.isFinite(params.overrideFair)
      ? params.overrideFair
      : midProbFromBuys(yes, no);

  // Early in window, pull toward 50/50; near close, trust market mid more
  const elapsed = Math.max(0, windowSeconds - secondsToClose);
  const trust = Math.min(1, elapsed / Math.max(60, windowSeconds * 0.7));
  let fair = mid * trust + 0.5 * (1 - trust);

  // Depth-weighted nudge only when we have real bid depth (not stub-only)
  const yesDepth = depthQty(orderbook.yesLevels);
  const noDepth = depthQty(orderbook.noLevels);
  if (yesDepth + noDepth > 0 && orderbook.priceSource === "market_buy") {
    const depthBias = yesDepth / (yesDepth + noDepth);
    fair = fair * 0.9 + depthBias * 0.1;
  }

  return Math.min(0.95, Math.max(0.05, fair));
}

function depthQty(
  levels?: Array<{ priceUsd: number; quantity: number }>,
): number {
  if (!levels?.length) return 0;
  return levels.slice(0, 5).reduce((s, l) => s + Math.max(0, l.quantity), 0);
}

export function fairEdgeSide(params: {
  fairProbYes: number;
  orderbook: PredictionOrderbook;
  minEdgeCents?: number;
}): "yes" | "no" | null {
  const minEdge = params.minEdgeCents ?? 0.03;
  const yesEdge = params.fairProbYes - params.orderbook.yesDollars;
  const noEdge = 1 - params.fairProbYes - params.orderbook.noDollars;

  if (yesEdge >= minEdge && yesEdge >= noEdge) return "yes";
  if (noEdge >= minEdge) return "no";
  return null;
}

/** Order-book imbalance: positive = YES/Up looks underpriced vs NO. */
export function orderbookImbalance(orderbook: PredictionOrderbook): number {
  const yes = orderbook.yesDollars;
  const no = orderbook.noDollars;
  if (yes <= 0 || no <= 0) return 0;
  // Residual after buying both; attribute to cheaper side
  const residual = Math.max(0, 1 - yes - no);
  if (yes < no) return residual + (no - yes);
  if (no < yes) return -(residual + (yes - no));
  return residual;
}

export function inferWindowSeconds(title: string): number {
  const t = title.toLowerCase();
  if (/\b5\s*m(in)?\b/.test(t)) return 300;
  if (/\b15\s*m(in)?\b/.test(t)) return 900;
  if (/\b1\s*h(our)?\b/.test(t)) return 3600;
  if (/\b4\s*h(our)?\b/.test(t)) return 14_400;
  return 900;
}
