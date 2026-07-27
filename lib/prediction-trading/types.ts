/** Jupiter Prediction Markets — internal types. */

export type PredictionSide = "yes" | "no";

export interface PredictionEvent {
  eventId: string;
  title: string;
  category?: string;
  provider?: string;
  markets: PredictionMarketSummary[];
}

export interface PredictionMarketSummary {
  marketId: string;
  title?: string;
  question?: string;
  openTime?: string;
  closeTime?: string;
  resolveAt?: string;
  result?: string | null;
  status?: string;
  provider?: string;
  tradable?: boolean;
  outcomeMint?: string;
  outcomes?: string[];
  buyYesPriceUsd?: number;
  buyNoPriceUsd?: number;
  sellYesPriceUsd?: number;
  sellNoPriceUsd?: number;
  lifecycleStatus?: string;
}

export interface PredictionMarket {
  marketId: string;
  title?: string;
  question?: string;
  openTime?: string;
  closeTime?: string;
  resolveAt?: string;
  result?: string | null;
  provider?: string;
  tradable?: boolean;
  outcomeMint?: string;
}

export interface PredictionOrderbook {
  marketId: string;
  yes: number;
  no: number;
  yesDollars: number;
  noDollars: number;
  combinedDollars: number;
  edgeBps: number;
  /** How buy prices were obtained — never trust bid_proxy for arb. */
  priceSource?: "market_buy" | "bid_proxy" | "mixed" | "none";
  yesLevels?: Array<{ priceUsd: number; quantity: number }>;
  noLevels?: Array<{ priceUsd: number; quantity: number }>;
}

export interface PredictionPosition {
  positionPubkey: string;
  marketId: string;
  isYes: boolean;
  contractsMicro: number;
  contractsDecimal?: string;
  totalCostUsd?: number;
  avgPriceUsd?: number;
  valueUsd?: number;
  markPriceUsd?: number;
  claimable?: boolean;
}

export interface MarketSnapshot {
  market: PredictionMarket;
  orderbook: PredictionOrderbook;
  secondsToClose: number;
  fairProbYes: number;
  isUpDown: boolean;
  /** Jupiter Forecast: paired DOWN market for the same 15m round */
  pairedMarketId?: string;
  isForecast?: boolean;
}

export type StrategyKind =
  | "temporal_arb_instant"
  | "temporal_arb_staged"
  | "rotation"
  | "inventory_tail"
  | "inventory_sell_favorite"
  | "resolution_snipe"
  | "directional_scalp"
  | "directional_scalp_exit";

export interface TradeSignal {
  strategy: StrategyKind;
  marketId: string;
  side: PredictionSide;
  isBuy: boolean;
  depositUsdc: number;
  reason: string;
  expectedEdgeBps?: number;
}

export interface LegLedger {
  marketId: string;
  yesCostUsd: number;
  noCostUsd: number;
  yesContractsMicro: number;
  noContractsMicro: number;
  stagedSide?: PredictionSide;
  stagedPrice?: number;
  stagedAt?: string;
  rotationCount: number;
  updatedAt: string;
}

export interface PredictionTradeLogEntry {
  id: string;
  timestamp: string;
  strategy: StrategyKind;
  marketId: string;
  side: PredictionSide;
  isBuy: boolean;
  depositUsdc: number;
  signature?: string;
  orderPubkey?: string;
  dryRun: boolean;
  reason: string;
  error?: string;
}

export interface PredictionTickSummary {
  ok: boolean;
  timestamp: string;
  dryRun: boolean;
  marketsScanned: number;
  signals: TradeSignal[];
  executed: string[];
  claims: string[];
  errors: string[];
  geoBlocked?: boolean;
  /** Human-readable why this tick did not fill (shown in /admin). */
  idleReason?: string;
}
