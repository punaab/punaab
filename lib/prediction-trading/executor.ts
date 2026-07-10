import {
  Connection,
  Keypair,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import {
  getSolanaAgentPrivateKey,
  getTradingSolanaAddress,
  isDryRun,
  PREDICTION_TRADING_LIMITS,
} from "../config";
import { getAlchemyConnection } from "../solana-alchemy";
import {
  closePosition,
  createClaimTransaction,
  createOrder,
  executeOrder,
  getOrderStatus,
  isForecastMarket,
  resolveForecastOrder,
  usdcToNative,
  type CreateOrderResult,
} from "./client";
import type { PredictionPosition, TradeSignal } from "./types";
import {
  appendPredictionLog,
  incrementTradesToday,
} from "./state";

function getSigner(): Keypair | null {
  const secret = getSolanaAgentPrivateKey();
  if (!secret) return null;
  try {
    return Keypair.fromSecretKey(bs58.decode(secret));
  } catch {
    try {
      const bytes = JSON.parse(secret) as number[];
      return Keypair.fromSecretKey(Uint8Array.from(bytes));
    } catch {
      return null;
    }
  }
}

function getConnection(): Connection {
  return getAlchemyConnection();
}

async function signTransaction(b64: string): Promise<VersionedTransaction> {
  const signer = getSigner();
  if (!signer) throw new Error("SOLANA_AGENT_PRIVATE_KEY required");

  const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
  tx.sign([signer]);
  return tx;
}

/** Per Jupiter docs: POST /execute for Forecast atomic_swap, else sendRawTransaction. */
async function submitBuild(build: CreateOrderResult): Promise<string> {
  if (!build.transaction) {
    throw new Error(build.message ?? build.code ?? "no_transaction_in_build");
  }

  const tx = await signTransaction(build.transaction);
  const signedB64 = Buffer.from(tx.serialize()).toString("base64");

  if (build.execution?.context) {
    const result = await executeOrder({
      signedTransaction: signedB64,
      context: build.execution.context,
    });
    if (result.status !== "Success" || result.error) {
      throw new Error(
        result.error ?? `execute_failed:${result.status}`,
      );
    }
    if (!result.signature) {
      throw new Error("execute_missing_signature");
    }
    return result.signature;
  }

  const conn = getConnection();
  const blockhashInfo = await conn.getLatestBlockhashAndContext({
    commitment: "confirmed",
  });

  const signature = await conn.sendRawTransaction(tx.serialize(), {
    maxRetries: 0,
    skipPreflight: true,
    preflightCommitment: "confirmed",
  });

  const confirmation = await conn.confirmTransaction(
    {
      signature,
      blockhash: blockhashInfo.value.blockhash,
      lastValidBlockHeight: blockhashInfo.value.lastValidBlockHeight,
    },
    "confirmed",
  );

  if (confirmation.value.err) {
    throw new Error(JSON.stringify(confirmation.value.err));
  }

  return signature;
}

function clampDepositUsdc(usdc: number, marketId: string): number {
  const min = PREDICTION_TRADING_LIMITS.minOrderUsdc;
  const max = isForecastMarket(marketId)
    ? PREDICTION_TRADING_LIMITS.maxForecastOrderUsdc
    : PREDICTION_TRADING_LIMITS.maxUsdcPerLeg;
  return Math.min(max, Math.max(min, usdc));
}

export async function executeBuySignal(
  signal: TradeSignal,
  options?: { pairedMarketId?: string },
): Promise<{ ok: boolean; signature?: string; error?: string }> {
  const dryRun = isDryRun();
  const wallet = getTradingSolanaAddress();

  if (!wallet) {
    await appendPredictionLog({
      strategy: signal.strategy,
      marketId: signal.marketId,
      side: signal.side,
      isBuy: true,
      depositUsdc: signal.depositUsdc,
      dryRun: true,
      reason: signal.reason,
      error: "no_wallet",
    });
    return { ok: false, error: "no_wallet" };
  }

  const depositUsdc = clampDepositUsdc(signal.depositUsdc, signal.marketId);

  if (dryRun) {
    await appendPredictionLog({
      strategy: signal.strategy,
      marketId: signal.marketId,
      side: signal.side,
      isBuy: true,
      depositUsdc,
      dryRun: true,
      reason: signal.reason,
    });
    return { ok: true };
  }

  if (!getSigner()) {
    await appendPredictionLog({
      strategy: signal.strategy,
      marketId: signal.marketId,
      side: signal.side,
      isBuy: true,
      depositUsdc,
      dryRun: false,
      reason: signal.reason,
      error: "no_signer",
    });
    return { ok: false, error: "no_signer" };
  }

  try {
    const forecast =
      isForecastMarket(signal.marketId) || Boolean(options?.pairedMarketId);
    const orderTarget = forecast
      ? resolveForecastOrder(
          signal.side,
          signal.marketId,
          options?.pairedMarketId,
        )
      : { marketId: signal.marketId, isYes: signal.side === "yes" };

    const build = await createOrder({
      ownerPubkey: wallet,
      marketId: orderTarget.marketId,
      isYes: orderTarget.isYes,
      isBuy: true,
      depositAmountNative: usdcToNative(depositUsdc),
    });

    const signature = await submitBuild(build);
    await incrementTradesToday(depositUsdc);

    // Polymarket path: poll order status (Forecast is atomic — skip)
    if (
      build.order.orderPubkey &&
      !forecast &&
      build.execution?.executionModel !== "atomic_swap"
    ) {
      await new Promise((r) => setTimeout(r, 3000));
      await getOrderStatus(build.order.orderPubkey).catch(() => null);
    }

    await appendPredictionLog({
      strategy: signal.strategy,
      marketId: signal.marketId,
      side: signal.side,
      isBuy: true,
      depositUsdc,
      signature,
      orderPubkey: build.order.orderPubkey,
      dryRun: false,
      reason: signal.reason,
    });
    return { ok: true, signature };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendPredictionLog({
      strategy: signal.strategy,
      marketId: signal.marketId,
      side: signal.side,
      isBuy: true,
      depositUsdc,
      dryRun: false,
      reason: signal.reason,
      error: message,
    });
    return { ok: false, error: message };
  }
}

export async function executeSellPosition(
  positionPubkey: string,
  reason: string,
): Promise<{ ok: boolean; signature?: string; error?: string }> {
  const wallet = getTradingSolanaAddress();
  if (!wallet) return { ok: false, error: "no_wallet" };

  if (isDryRun()) {
    await appendPredictionLog({
      strategy: "inventory_sell_favorite",
      marketId: positionPubkey,
      side: "yes",
      isBuy: false,
      depositUsdc: 0,
      dryRun: true,
      reason,
    });
    return { ok: true };
  }

  try {
    const build = await closePosition({
      positionPubkey,
      ownerPubkey: wallet,
    });
    const signature = await submitBuild({
      transaction: build.transaction,
      execution: build.execution,
      order: {},
    });
    await appendPredictionLog({
      strategy: "inventory_sell_favorite",
      marketId: positionPubkey,
      side: "yes",
      isBuy: false,
      depositUsdc: 0,
      signature,
      dryRun: false,
      reason,
    });
    return { ok: true, signature };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

export async function claimPosition(
  position: PredictionPosition,
): Promise<{ ok: boolean; signature?: string; error?: string }> {
  if (isForecastMarket(position.marketId)) {
    return { ok: true }; // Forecast auto-settles per docs
  }

  if (isDryRun()) {
    await appendPredictionLog({
      strategy: "temporal_arb_instant",
      marketId: position.marketId,
      side: position.isYes ? "yes" : "no",
      isBuy: false,
      depositUsdc: 0,
      dryRun: true,
      reason: `claim_dry_run:${position.positionPubkey}`,
    });
    return { ok: true };
  }

  try {
    const build = await createClaimTransaction(position.positionPubkey);
    const signature = await submitBuild({
      transaction: build.transaction,
      execution: build.execution,
      order: {},
    });
    await appendPredictionLog({
      strategy: "temporal_arb_instant",
      marketId: position.marketId,
      side: position.isYes ? "yes" : "no",
      isBuy: false,
      depositUsdc: 0,
      signature,
      dryRun: false,
      reason: `claimed:${position.positionPubkey}`,
    });
    return { ok: true, signature };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

export function hasPredictionSigner(): boolean {
  return getSigner() !== null;
}
