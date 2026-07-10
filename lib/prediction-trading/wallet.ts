import { PublicKey } from "@solana/web3.js";
import {
  getTradingSolanaAddress,
  PREDICTION_MINT_USDC,
} from "../config";
import {
  fetchSolanaWalletHoldings,
  getAlchemyConnection,
} from "../solana-alchemy";
import { getPositions } from "./client";

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);

export interface PredictionWalletSnapshot {
  address: string;
  sol: number;
  usdc: number;
  positionValueUsd: number;
  openPositions: number;
  capturedAt: string;
  positions: Array<{
    positionPubkey: string;
    marketId: string;
    isYes: boolean;
    valueUsd: number;
    avgPriceUsd?: number;
    claimable?: boolean;
  }>;
}

/** Direct SPL USDC balance — more reliable than DAS for admin display. */
async function fetchUsdcBalance(owner: string): Promise<number> {
  const conn = getAlchemyConnection();
  const ownerPk = new PublicKey(owner);
  const mint = new PublicKey(PREDICTION_MINT_USDC);

  let total = 0;
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    try {
      const accounts = await conn.getParsedTokenAccountsByOwner(ownerPk, {
        mint,
        programId,
      });
      for (const { account } of accounts.value) {
        const info = account.data.parsed?.info?.tokenAmount as
          | { uiAmount?: number | null; uiAmountString?: string }
          | undefined;
        const amt =
          info?.uiAmount ??
          (info?.uiAmountString != null ? Number(info.uiAmountString) : 0);
        if (Number.isFinite(amt) && amt > 0) total += amt;
      }
    } catch (error) {
      console.warn(`[prediction-wallet] USDC via ${programId.toBase58().slice(0, 8)}:`, error);
    }
  }
  return total;
}

async function fetchSolBalance(owner: string): Promise<number> {
  const lamports = await getAlchemyConnection().getBalance(
    new PublicKey(owner),
    "confirmed",
  );
  return lamports / 1e9;
}

export async function fetchPredictionWalletSnapshot(): Promise<PredictionWalletSnapshot | null> {
  const address = getTradingSolanaAddress();
  if (!address) return null;

  let sol = 0;
  let usdc = 0;

  // Primary: live RPC (SOL + USDC mint accounts)
  try {
    const [solBal, usdcBal] = await Promise.all([
      fetchSolBalance(address),
      fetchUsdcBalance(address),
    ]);
    sol = solBal;
    usdc = usdcBal;
  } catch (error) {
    console.warn("[prediction-wallet] rpc balances:", error);
  }

  // Fallback: DAS holdings cache if USDC still 0
  if (usdc <= 0) {
    try {
      const holdings = await fetchSolanaWalletHoldings(address, {
        forceRefresh: true,
      });
      if (sol <= 0) sol = holdings.solBalance;
      const usdcToken = holdings.fungibleTokens.find(
        (t) =>
          t.mint === PREDICTION_MINT_USDC ||
          t.symbol?.toUpperCase() === "USDC",
      );
      if (usdcToken?.uiAmount) usdc = usdcToken.uiAmount;
    } catch (error) {
      console.warn("[prediction-wallet] holdings fallback:", error);
    }
  }

  let positionValueUsd = 0;
  let openPositions = 0;
  const positions: PredictionWalletSnapshot["positions"] = [];
  try {
    const raw = await getPositions(address);
    for (const p of raw) {
      const value = p.valueUsd ?? 0;
      positionValueUsd += value;
      openPositions += 1;
      positions.push({
        positionPubkey: p.positionPubkey,
        marketId: p.marketId,
        isYes: p.isYes,
        valueUsd: value,
        avgPriceUsd: p.avgPriceUsd,
        claimable: p.claimable,
      });
    }
  } catch (error) {
    console.warn("[prediction-wallet] positions:", error);
  }

  return {
    address,
    sol,
    usdc,
    positionValueUsd,
    openPositions,
    capturedAt: new Date().toISOString(),
    positions,
  };
}
