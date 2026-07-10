import {
  Connection,
  Keypair,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import {
  getSolanaAgentPrivateKey,
  isDryRun,
  isTradingEnabled,
  PREDICTION_MINT_USDC,
  PREDICTION_TRADING_LIMITS,
  TRADING_LIMITS,
} from "../config";
import { getAlchemyConnection, toTokenBaseUnits } from "../solana-alchemy";
import { getJupiterQuote, MINT_SOL } from "../trading";
import {
  fetchPredictionWalletSnapshot,
  type PredictionWalletSnapshot,
  type WalletTokenBalance,
} from "./wallet";

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

function decimalsFor(token: WalletTokenBalance): number {
  if (typeof token.decimals === "number" && token.decimals >= 0) {
    return token.decimals;
  }
  if (token.mint === MINT_SOL) return 9;
  if (token.mint === PREDICTION_MINT_USDC) return 6;
  return 6;
}

async function swapMintToUsdc(params: {
  inputMint: string;
  amountUi: number;
  decimals: number;
  reason: string;
}): Promise<{ ok: boolean; outUsdc?: number; signature?: string; error?: string }> {
  const signer = getSigner();
  if (!signer) return { ok: false, error: "no_signer" };

  const amountRaw = toTokenBaseUnits(params.amountUi, params.decimals);
  if (amountRaw <= BigInt(0)) return { ok: false, error: "zero_amount" };

  let quote;
  try {
    quote = await getJupiterQuote({
      inputMint: params.inputMint,
      outputMint: PREDICTION_MINT_USDC,
      amountRaw,
      slippageBps: Math.max(TRADING_LIMITS.defaultSlippageBps, 150),
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "quote_failed",
    };
  }

  const outUsdc = Number(quote.outAmount) / 1e6;

  if (isDryRun()) {
    console.log(
      `[prediction-fund] dry-run swap ${params.amountUi} ${params.inputMint.slice(0, 6)}… → ~$${outUsdc.toFixed(2)} USDC (${params.reason})`,
    );
    return { ok: true, outUsdc };
  }

  try {
    const swapRes = await fetch("https://quote-api.jup.ag/v6/swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: signer.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: "auto",
      }),
    });
    if (!swapRes.ok) {
      return {
        ok: false,
        error: `swap_build_${swapRes.status}:${(await swapRes.text()).slice(0, 120)}`,
      };
    }
    const { swapTransaction } = (await swapRes.json()) as {
      swapTransaction: string;
    };
    const tx = VersionedTransaction.deserialize(
      Buffer.from(swapTransaction, "base64"),
    );
    tx.sign([signer]);
    const conn = getConnection();
    const signature = await conn.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });
    await conn.confirmTransaction(signature, "confirmed");
    console.log(
      `[prediction-fund] swapped → ~$${outUsdc.toFixed(2)} USDC sig=${signature.slice(0, 12)}…`,
    );
    return { ok: true, outUsdc, signature };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "swap_failed",
    };
  }
}

/**
 * Ensure the trading wallet holds enough USDC for a Forecast buy.
 * Sells SOL (above gas reserve) and other priced SPL bags via Jupiter as needed.
 */
export async function ensureUsdcForPrediction(
  neededUsdc: number,
): Promise<{
  ok: boolean;
  usdc: number;
  tradeableCapitalUsd: number;
  swaps: string[];
  error?: string;
}> {
  const empty = {
    ok: false,
    usdc: 0,
    tradeableCapitalUsd: 0,
    swaps: [] as string[],
  };

  if (!isTradingEnabled() && !isDryRun()) {
    return { ...empty, error: "trading_disabled" };
  }

  let snap = await fetchPredictionWalletSnapshot();
  if (!snap) return { ...empty, error: "no_wallet" };

  const buffer = 0.25;
  const target = neededUsdc + buffer;
  const swaps: string[] = [];

  if (snap.usdc >= target) {
    return {
      ok: true,
      usdc: snap.usdc,
      tradeableCapitalUsd: snap.tradeableCapitalUsd,
      swaps,
    };
  }

  if (!PREDICTION_TRADING_LIMITS.autoFundUsdc) {
    return {
      ok: false,
      usdc: snap.usdc,
      tradeableCapitalUsd: snap.tradeableCapitalUsd,
      swaps,
      error: "auto_fund_disabled",
    };
  }

  if (snap.tradeableCapitalUsd + 0.01 < target) {
    return {
      ok: false,
      usdc: snap.usdc,
      tradeableCapitalUsd: snap.tradeableCapitalUsd,
      swaps,
      error: `insufficient_capital need=$${target.toFixed(2)} have=$${snap.tradeableCapitalUsd.toFixed(2)}`,
    };
  }

  let shortfall = target - snap.usdc;
  const minBag = PREDICTION_TRADING_LIMITS.minFundTokenUsd;

  // Prefer SOL (liquid), then largest alt bags
  const candidates = snap.topTokens
    .filter((t) => {
      if (t.mint === PREDICTION_MINT_USDC) return false;
      if (t.priceUsd <= 0 || t.valueUsd < minBag) return false;
      if (t.mint === MINT_SOL) {
        const avail = Math.max(0, t.amount - snap!.solGasReserve);
        return avail * t.priceUsd >= minBag;
      }
      return true;
    })
    .sort((a, b) => {
      if (a.mint === MINT_SOL) return -1;
      if (b.mint === MINT_SOL) return 1;
      return b.valueUsd - a.valueUsd;
    });

  for (const token of candidates) {
    if (shortfall <= 0.05) break;

    const availableUi =
      token.mint === MINT_SOL
        ? Math.max(0, token.amount - snap.solGasReserve)
        : token.amount * 0.99;
    const availableUsd = availableUi * token.priceUsd;
    if (availableUsd < minBag) continue;

    // Sell enough to cover shortfall + ~4% slippage cushion
    const sellUsd = Math.min(availableUsd, shortfall * 1.04);
    const sellUi = sellUsd / token.priceUsd;
    if (sellUi <= 0) continue;

    const decimals = decimalsFor(token);
    const result = await swapMintToUsdc({
      inputMint: token.mint,
      amountUi: sellUi,
      decimals,
      reason: `fund_usdc_for_prediction shortfall=$${shortfall.toFixed(2)}`,
    });

    if (!result.ok) {
      console.warn(
        `[prediction-fund] skip ${token.symbol}: ${result.error}`,
      );
      continue;
    }

    swaps.push(
      `${token.symbol}:${sellUi.toFixed(4)}→$${result.outUsdc?.toFixed(2) ?? "?"}`,
    );
    shortfall -= result.outUsdc ?? sellUsd / 1.04;

    // Refresh after each live swap; dry-run estimates USDC forward
    if (isDryRun()) {
      snap = {
        ...snap,
        usdc: snap.usdc + (result.outUsdc ?? 0),
      };
    } else {
      // Brief settle before re-read
      await new Promise((r) => setTimeout(r, 1500));
      const refreshed = await fetchPredictionWalletSnapshot();
      if (refreshed) snap = refreshed;
    }
  }

  const finalUsdc = snap.usdc;
  const ok = finalUsdc >= neededUsdc - 0.05 || (isDryRun() && shortfall <= 0.5);

  return {
    ok,
    usdc: finalUsdc,
    tradeableCapitalUsd: snap.tradeableCapitalUsd,
    swaps,
    error: ok
      ? undefined
      : `usdc_short after_swaps have=$${finalUsdc.toFixed(2)} need=$${neededUsdc.toFixed(2)}`,
  };
}
