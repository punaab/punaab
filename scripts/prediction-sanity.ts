/**
 * Offline sanity checks for prediction strategies (no API/Redis).
 */
import { combinedCostOk } from "../lib/prediction-trading/risk";
import { signalsTemporalArb } from "../lib/prediction-trading/strategies/temporal-arb";
import {
  signalsDirectionalScalp,
  sizeScalpDeposit,
} from "../lib/prediction-trading/strategies/directional-scalp";
import {
  isExecutableBuyPrice,
  validateForecastBuyPair,
} from "../lib/prediction-trading/pricing";
import type { MarketSnapshot } from "../lib/prediction-trading/types";

function snap(
  yes: number,
  no: number,
  opts?: Partial<MarketSnapshot> & {
    fairProbYes?: number;
    priceSource?: MarketSnapshot["orderbook"]["priceSource"];
  },
): MarketSnapshot {
  const marketId = opts?.market?.marketId ?? "m1";
  const combined = yes + no;
  return {
    market: {
      marketId,
      title: opts?.market?.title ?? "BTC Up or Down 15m",
    },
    orderbook: {
      marketId,
      yes,
      no,
      yesDollars: yes,
      noDollars: no,
      combinedDollars: combined,
      edgeBps: Math.round((1 - combined) * 10_000),
      priceSource: opts?.priceSource ?? "market_buy",
    },
    secondsToClose: opts?.secondsToClose ?? 600,
    fairProbYes: opts?.fairProbYes ?? 0.5,
    isUpDown: true,
    isForecast: opts?.isForecast ?? true,
    pairedMarketId: opts?.pairedMarketId,
  };
}

let failed = 0;

if (!combinedCostOk(0.96)) {
  console.error("FAIL: 0.96 should pass combinedCostOk");
  failed++;
}

if (combinedCostOk(0.99)) {
  console.error("FAIL: 0.99 should fail combinedCostOk");
  failed++;
}

const instant = signalsTemporalArb(snap(0.47, 0.49), undefined);
if (instant.length < 2) {
  console.error("FAIL: instant arb should signal both legs", instant);
  failed++;
}

// Classic bug: yes@0.35 + no@0.01 from lowest bid — must NOT trade
const stub = signalsTemporalArb(snap(0.35, 0.01), undefined);
if (stub.length !== 0) {
  console.error("FAIL: stub no@0.01 must not arb", stub);
  failed++;
}

const stubPair = validateForecastBuyPair(0.35, 0.01);
if (stubPair.ok) {
  console.error("FAIL: validateForecastBuyPair should reject stub", stubPair);
  failed++;
}

if (isExecutableBuyPrice(0.01)) {
  console.error("FAIL: 0.01 must not be executable");
  failed++;
}

if (!isExecutableBuyPrice(0.35)) {
  console.error("FAIL: 0.35 should be executable");
  failed++;
}

const bidProxy = signalsTemporalArb(
  snap(0.47, 0.49, { priceSource: "bid_proxy" }),
  undefined,
);
if (bidProxy.length !== 0) {
  console.error("FAIL: bid_proxy books must not arb", bidProxy);
  failed++;
}

const staged = signalsTemporalArb(snap(0.32, 0.68), undefined);
if (staged.length === 0 || staged[0].strategy !== "temporal_arb_staged") {
  console.error("FAIL: cheap tail should stage", staged);
  failed++;
}

// Directional scalp: Up at 5¢ when fair says ~25% → clear edge
const scalpUp = signalsDirectionalScalp(
  snap(0.05, 0.80, { fairProbYes: 0.25, isForecast: true }),
  undefined,
  { walletUsdc: 100, tradesToday: 0 },
);
if (
  scalpUp.length !== 1 ||
  scalpUp[0].strategy !== "directional_scalp" ||
  scalpUp[0].side !== "yes"
) {
  console.error("FAIL: should scalp YES at 5¢ with fair 25%", scalpUp);
  failed++;
}

// No scalp on 1¢ stub even if fair looks high
const noStubScalp = signalsDirectionalScalp(
  snap(0.01, 0.90, { fairProbYes: 0.4, isForecast: true }),
  undefined,
  { walletUsdc: 100, tradesToday: 0 },
);
if (noStubScalp.length !== 0) {
  console.error("FAIL: 1¢ stub must not scalp", noStubScalp);
  failed++;
}

// No scalp when fairly priced longshot (1¢ with fair ~1.2% — below 2× multiple)
const noScalp = signalsDirectionalScalp(
  snap(0.01, 0.97, { fairProbYes: 0.012, isForecast: true }),
  undefined,
  { walletUsdc: 100, tradesToday: 0 },
);
if (noScalp.length !== 0) {
  console.error("FAIL: correctly priced longshot should not scalp", noScalp);
  failed++;
}

// One side only — never both
const bothCheap = signalsDirectionalScalp(
  snap(0.08, 0.10, { fairProbYes: 0.55, isForecast: true }),
  undefined,
  { walletUsdc: 200, tradesToday: 0 },
);
if (bothCheap.length > 1) {
  console.error("FAIL: scalp must pick one side only", bothCheap);
  failed++;
}

const sized = sizeScalpDeposit(100, 0.05);
if (sized < 5 || sized > 15) {
  console.error("FAIL: scalp size out of bounds", sized);
  failed++;
}

if (failed === 0) {
  console.log(
    "prediction-sanity: OK (arb + stub rejection + directional scalp)",
  );
  process.exit(0);
} else {
  process.exit(1);
}
