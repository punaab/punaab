import {
  getJupiterApiKey,
  getTradingSolanaAddress,
  isDryRun,
  isPredictionTradingEnabled,
  isTradingEnabled,
  PREDICTION_TRADING_LIMITS,
} from "./config";
import { checkPredictionApiAccess } from "./prediction-trading/client";
import { hasPredictionSigner } from "./prediction-trading/executor";
import {
  getAllLegs,
  getArbHistory,
  getLastTickSummary,
  getPredictionLog,
  getTradesToday,
  getUsdcDeployedToday,
  getWalletHistory,
} from "./prediction-trading/state";
import { fetchPredictionWalletSnapshot } from "./prediction-trading/wallet";

export async function fetchPredictionDashboard() {
  const [
    access,
    lastTick,
    log,
    legs,
    tradesToday,
    usdcToday,
    arbHistory,
    walletHistory,
    wallet,
  ] = await Promise.all([
    checkPredictionApiAccess().catch((e) => ({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    })),
    getLastTickSummary(),
    getPredictionLog(20),
    getAllLegs(),
    getTradesToday(),
    getUsdcDeployedToday(),
    getArbHistory(24),
    getWalletHistory(24),
    fetchPredictionWalletSnapshot().catch(() => null),
  ]);

  const latestArb = arbHistory[arbHistory.length - 1] ?? null;
  const latestWallet = walletHistory[walletHistory.length - 1] ?? null;

  return {
    enabled: isPredictionTradingEnabled(),
    tradingEnabled: isTradingEnabled(),
    dryRun: isDryRun(),
    hasApiKey: Boolean(getJupiterApiKey()),
    hasSigner: hasPredictionSigner(),
    walletAddress: getTradingSolanaAddress() ?? null,
    limits: PREDICTION_TRADING_LIMITS,
    apiAccess: access,
    lastTick,
    log,
    openLegs: [...legs.values()],
    tradesToday,
    usdcDeployedToday: usdcToday,
    arbHistory,
    latestArb,
    walletHistory,
    latestWallet,
    wallet,
  };
}
