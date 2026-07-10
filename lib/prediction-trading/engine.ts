import { getTradingSolanaAddress, isDryRun, PREDICTION_TRADING_LIMITS } from "../config";
import { checkPredictionApiAccess, forecastDownMarketId, forecastUpMarketId, getPositions } from "./client";
import { claimPosition, executeBuySignal, executeSellPosition } from "./executor";
import {
  canRunPredictionTrading,
  type RiskContext,
  validateSignal,
} from "./risk";
import { scanLiveCryptoMarkets } from "./scanner";
import {
  appendArbHistory,
  appendWalletHistory,
  clearPredictionGeoBlocked,
  getAllLegs,
  getTradesToday,
  getUsdcDeployedToday,
  isPredictionGeoBlockedCached,
  markPredictionGeoBlocked,
  pruneNonForecastLegs,
  saveLeg,
  setLastTickSummary,
} from "./state";
import { fetchPredictionWalletSnapshot } from "./wallet";
import { ensureUsdcForPrediction } from "./fund-usdc";
import { signalsInventoryMm } from "./strategies/inventory-mm";
import { bumpRotation, signalsRotation } from "./strategies/rotation";
import { signalsResolutionSnipe } from "./strategies/resolution-snipe";
import { signalsDirectionalScalp } from "./strategies/directional-scalp";
import {
  recordStagedLeg,
  signalsTemporalArb,
} from "./strategies/temporal-arb";
import type { PredictionTickSummary, TradeSignal } from "./types";

export async function runPredictionTick(): Promise<PredictionTickSummary> {
  const summary: PredictionTickSummary = {
    ok: true,
    timestamp: new Date().toISOString(),
    dryRun: isDryRun(),
    marketsScanned: 0,
    signals: [],
    executed: [],
    claims: [],
    errors: [],
  };

  const gate = canRunPredictionTrading();
  if (!gate.ok) {
    summary.ok = false;
    summary.errors.push(gate.reason ?? "disabled");
    await setLastTickSummary(summary);
    return summary;
  }

  // Drop stale POLY ledger legs that blocked slots / confused the radar
  try {
    const removed = await pruneNonForecastLegs(
      PREDICTION_TRADING_LIMITS.scalpAllowPolymarket,
    );
    if (removed.length) {
      summary.errors.push(`pruned_legs:${removed.length}`);
    }
  } catch (error) {
    console.warn("[prediction-engine] prune legs:", error);
  }

  const access = await checkPredictionApiAccess();
  if (!access.ok) {
    summary.ok = false;
    summary.geoBlocked = access.geoBlocked;
    summary.errors.push(access.error ?? "api_unreachable");
    if (access.geoBlocked) {
      await markPredictionGeoBlocked(access.error ?? "api_geo");
    }
    await setLastTickSummary(summary);
    return summary;
  }

  // Jupiter blocks US/KR IPs on /orders — don't spam buys from a blocked egress
  const geoCached = await isPredictionGeoBlockedCached();
  if (geoCached && !isDryRun()) {
    summary.ok = false;
    summary.geoBlocked = true;
    summary.errors.push(
      "geo_blocked: Jupiter Prediction unavailable from this IP (US/KR). Run trader from a non-US region or wait for cache TTL.",
    );
    // Still scan for radar, but skip live orders below
  }

  // Wallet snapshot early — size bets to full tradeable capital (SOL/SPL → USDC)
  let walletUsdc = 0;
  let tradeableCapitalUsd = 0;
  try {
    const walletSnap = await fetchPredictionWalletSnapshot();
    if (walletSnap) {
      walletUsdc = walletSnap.usdc;
      tradeableCapitalUsd = walletSnap.tradeableCapitalUsd;
      await appendWalletHistory({
        timestamp: summary.timestamp,
        address: walletSnap.address,
        sol: walletSnap.sol,
        usdc: walletSnap.usdc,
        solValueUsd: walletSnap.solValueUsd,
        tokensValueUsd: walletSnap.tokensValueUsd,
        positionValueUsd: walletSnap.positionValueUsd,
        totalWorthUsd: walletSnap.totalWorthUsd,
        tradeableCapitalUsd: walletSnap.tradeableCapitalUsd,
        openPositions: walletSnap.openPositions,
      });
    }
  } catch (error) {
    console.warn("[prediction-engine] wallet snapshot:", error);
  }

  // Size / risk against liquid capital, not USDC alone
  const capitalForSizing =
    tradeableCapitalUsd > 0 ? tradeableCapitalUsd : walletUsdc;

  let snapshots;
  try {
    snapshots = await scanLiveCryptoMarkets();
    summary.marketsScanned = snapshots.length;

    const arbMarkets = snapshots.map((s) => ({
      marketId: s.market.marketId,
      title: s.market.title ?? s.market.marketId,
      yes: s.orderbook.yesDollars,
      no: s.orderbook.noDollars,
      combined: s.orderbook.combinedDollars,
      edgeBps: s.orderbook.edgeBps,
      isForecast: s.isForecast,
      secondsToClose: s.secondsToClose,
    }));
    const bestEdgeBps = arbMarkets.reduce(
      (max, m) => Math.max(max, m.edgeBps),
      0,
    );
    await appendArbHistory({
      timestamp: summary.timestamp,
      markets: arbMarkets,
      bestEdgeBps,
      marketsScanned: snapshots.length,
    });
  } catch (error) {
    summary.ok = false;
    summary.errors.push(
      error instanceof Error ? error.message : "scan_failed",
    );
    await setLastTickSummary(summary);
    return summary;
  }

  const legs = await getAllLegs();
  const ctx: RiskContext = {
    openMarketIds: new Set(legs.keys()),
    legs,
    tradesToday: await getTradesToday(),
    usdcDeployedToday: await getUsdcDeployedToday(),
    walletUsdc: capitalForSizing,
  };

  const wallet = getTradingSolanaAddress();
  if (wallet) {
    try {
      const positions = await getPositions(wallet);
      for (const p of positions) {
        if (p.claimable) {
          const result = await claimPosition(p);
          if (result.ok) {
            summary.claims.push(p.positionPubkey);
          } else if (result.error) {
            summary.errors.push(`claim:${result.error}`);
          }
        }
      }
    } catch (error) {
      summary.errors.push(
        `positions:${error instanceof Error ? error.message : "failed"}`,
      );
    }
  }

  const scalpCtx = {
    walletUsdc: capitalForSizing,
    tradesToday: ctx.tradesToday,
  };

  const allSignals: TradeSignal[] = [];

  for (const snap of snapshots) {
    const leg = ctx.legs.get(snap.market.marketId);
    // 1) Risk-free-ish arb first
    allSignals.push(...signalsTemporalArb(snap, leg));
    // 2) Directional scalp (Polymarket-style volume snipes)
    allSignals.push(...signalsDirectionalScalp(snap, leg, scalpCtx));
    // 3) Rotation / inventory / resolution (secondary)
    allSignals.push(...signalsRotation(snap, leg));
    allSignals.push(...signalsInventoryMm(snap, leg));
    allSignals.push(...signalsResolutionSnipe(snap));
  }

  const priority = (s: TradeSignal) => {
    if (s.strategy.startsWith("temporal_arb")) return 0;
    if (s.strategy === "directional_scalp") return 1;
    if (s.strategy === "directional_scalp_exit") return 1;
    if (s.strategy === "rotation") return 2;
    if (s.strategy.startsWith("inventory")) return 3;
    return 4;
  };
  allSignals.sort((a, b) => priority(a) - priority(b));

  const seen = new Set<string>();
  const toExecute: TradeSignal[] = [];
  const maxPerTick = PREDICTION_TRADING_LIMITS.maxSignalsPerTick;
  for (const s of allSignals) {
    const key = `${s.marketId}:${s.side}:${s.isBuy}:${s.strategy}`;
    if (seen.has(key)) continue;

    // Forecast-only by default — never execute POLY stub books
    if (
      !s.marketId.startsWith("BISON-") &&
      !PREDICTION_TRADING_LIMITS.scalpAllowPolymarket
    ) {
      continue;
    }

    // Instant temporal arb needs both YES+NO in one tick; block only for directional strategies
    if (s.isBuy && !s.strategy.startsWith("temporal_arb")) {
      const otherSide = s.side === "yes" ? "no" : "yes";
      if (
        toExecute.some(
          (x) => x.marketId === s.marketId && x.isBuy && x.side === otherSide,
        )
      ) {
        continue;
      }
    }
    seen.add(key);

    const snap = snapshots.find((x) => x.market.marketId === s.marketId);
    if (!snap) continue;

    const check = validateSignal(s, snap, ctx);
    if (!check.ok) continue;

    toExecute.push(s);
    if (toExecute.length >= maxPerTick) break;
  }

  summary.signals = toExecute;

  if ((geoCached || summary.geoBlocked) && !isDryRun()) {
    summary.ok = false;
    summary.geoBlocked = true;
    if (!summary.errors.some((e) => e.startsWith("geo_blocked"))) {
      summary.errors.push("geo_blocked: skipping live orders");
    }
    await setLastTickSummary(summary);
    return summary;
  }

  for (const signal of toExecute) {
    const snap = snapshots.find((x) => x.market.marketId === signal.marketId);

    if (!signal.isBuy) {
      const walletAddr = getTradingSolanaAddress();
      if (walletAddr) {
        try {
          const positions = await getPositions(walletAddr);
          const targetMarketId = snap?.isForecast
            ? signal.side === "yes"
              ? forecastUpMarketId(signal.marketId)
              : snap.pairedMarketId ?? forecastDownMarketId(signal.marketId)
            : signal.marketId;
          const match = positions.find((p) => p.marketId === targetMarketId);
          if (match?.positionPubkey) {
            const sell = await executeSellPosition(
              match.positionPubkey,
              signal.reason,
            );
            if (sell.ok) {
              summary.executed.push(`sell:${match.positionPubkey.slice(0, 8)}`);
            } else if (sell.error) {
              summary.errors.push(`sell:${sell.error}`);
            }
          }
        } catch (error) {
          summary.errors.push(
            `sell:${error instanceof Error ? error.message : "failed"}`,
          );
        }
      }
      continue;
    }

    if (!snap) continue;

    // Forecast deposits are USDC — top up from SOL / other tokens if needed
    try {
      const fund = await ensureUsdcForPrediction(signal.depositUsdc);
      if (fund.swaps.length) {
        summary.executed.push(`fund:${fund.swaps.join(",")}`);
      }
      if (!fund.ok) {
        summary.errors.push(`fund:${fund.error ?? "usdc_short"}`);
        continue;
      }
      walletUsdc = fund.usdc;
      if (fund.tradeableCapitalUsd > 0) {
        tradeableCapitalUsd = fund.tradeableCapitalUsd;
        ctx.walletUsdc = fund.tradeableCapitalUsd;
      }
    } catch (error) {
      summary.errors.push(
        `fund:${error instanceof Error ? error.message : "failed"}`,
      );
      continue;
    }

    const price =
      signal.side === "yes"
        ? snap.orderbook.yesDollars
        : snap.orderbook.noDollars;

    const result = await executeBuySignal(signal, {
      pairedMarketId: snap.pairedMarketId,
    });
    if (result.ok) {
      summary.executed.push(
        result.signature
          ? `${signal.strategy}:${signal.marketId}:${result.signature.slice(0, 8)}`
          : `${signal.strategy}:${signal.marketId}:dry_run`,
      );

      // Successful live order proves egress is allowed
      await clearPredictionGeoBlocked().catch(() => undefined);

      let leg = ctx.legs.get(signal.marketId);
      if (signal.strategy === "rotation") {
        leg = leg
          ? bumpRotation({
              ...leg,
              ...(signal.side === "yes"
                ? { yesCostUsd: leg.yesCostUsd + signal.depositUsdc }
                : { noCostUsd: leg.noCostUsd + signal.depositUsdc }),
            })
          : recordStagedLeg(undefined, signal, price);
      } else {
        leg = recordStagedLeg(leg, signal, price);
      }
      if (leg) {
        await saveLeg(leg);
        ctx.legs.set(signal.marketId, leg);
        ctx.openMarketIds.add(signal.marketId);
      }
      // Track spend so later signals in same tick respect wallet
      ctx.walletUsdc = Math.max(0, ctx.walletUsdc - signal.depositUsdc);
      ctx.tradesToday += 1;
    } else if (result.error) {
      summary.errors.push(`${signal.strategy}:${result.error}`);
      if (result.geoBlocked) {
        summary.geoBlocked = true;
        summary.ok = false;
        await markPredictionGeoBlocked(result.error);
        summary.errors.push(
          "geo_blocked: stopping further orders this tick (US/KR IP)",
        );
        break;
      }
    }
  }

  await setLastTickSummary(summary);
  return summary;
}
