import { PublicKey } from "@solana/web3.js";
import {
  getJupiterApiKey,
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

const MINT_SOL = "So11111111111111111111111111111111111111112";
const MINT_USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const MINT_JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const MINT_JUPUSD = "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD";

const KNOWN_SYMBOLS: Record<string, string> = {
  [PREDICTION_MINT_USDC]: "USDC",
  [MINT_USDT]: "USDT",
  [MINT_JUP]: "JUP",
  [MINT_JUPUSD]: "JupUSD",
  [MINT_SOL]: "SOL",
};

export interface WalletTokenBalance {
  mint: string;
  symbol: string;
  amount: number;
  priceUsd: number;
  valueUsd: number;
}

export interface PredictionWalletSnapshot {
  address: string;
  sol: number;
  usdc: number;
  solPriceUsd: number;
  solValueUsd: number;
  tokensValueUsd: number;
  positionValueUsd: number;
  /** SOL + SPL tokens (priced) + open prediction positions */
  totalWorthUsd: number;
  openPositions: number;
  capturedAt: string;
  topTokens: WalletTokenBalance[];
  positions: Array<{
    positionPubkey: string;
    marketId: string;
    isYes: boolean;
    valueUsd: number;
    avgPriceUsd?: number;
    claimable?: boolean;
  }>;
}

interface SplHolding {
  mint: string;
  symbol: string;
  amount: number;
  decimals: number;
}

/** Direct SPL USDC balance — more reliable than DAS for admin display. */
async function fetchUsdcBalance(owner: string): Promise<number> {
  const holdings = await fetchAllSplHoldings(owner);
  return holdings
    .filter((h) => h.mint === PREDICTION_MINT_USDC)
    .reduce((sum, h) => sum + h.amount, 0);
}

async function fetchSolBalance(owner: string): Promise<number> {
  const lamports = await getAlchemyConnection().getBalance(
    new PublicKey(owner),
    "confirmed",
  );
  return lamports / 1e9;
}

async function fetchAllSplHoldings(owner: string): Promise<SplHolding[]> {
  const conn = getAlchemyConnection();
  const ownerPk = new PublicKey(owner);
  const byMint = new Map<string, SplHolding>();

  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    try {
      const accounts = await conn.getParsedTokenAccountsByOwner(ownerPk, {
        programId,
      });
      for (const { account } of accounts.value) {
        const info = account.data.parsed?.info as
          | {
              mint?: string;
              tokenAmount?: {
                uiAmount?: number | null;
                uiAmountString?: string;
                decimals?: number;
              };
            }
          | undefined;
        const mint = info?.mint;
        if (!mint) continue;
        const amt =
          info?.tokenAmount?.uiAmount ??
          (info?.tokenAmount?.uiAmountString != null
            ? Number(info.tokenAmount.uiAmountString)
            : 0);
        if (!Number.isFinite(amt) || amt <= 0) continue;
        const existing = byMint.get(mint);
        if (existing) {
          existing.amount += amt;
        } else {
          byMint.set(mint, {
            mint,
            symbol: KNOWN_SYMBOLS[mint] ?? mint.slice(0, 4),
            amount: amt,
            decimals: info?.tokenAmount?.decimals ?? 0,
          });
        }
      }
    } catch (error) {
      console.warn(
        `[prediction-wallet] SPL via ${programId.toBase58().slice(0, 8)}:`,
        error,
      );
    }
  }

  return [...byMint.values()];
}

/** Jupiter Price API v3 — separate from Prediction pacing. */
async function fetchUsdPrices(
  mints: string[],
): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  const unique = [...new Set(mints.filter(Boolean))];
  if (!unique.length) return prices;

  // Stables fallback if price API misses them
  prices.set(PREDICTION_MINT_USDC, 1);
  prices.set(MINT_USDT, 1);
  prices.set(MINT_JUPUSD, 1);

  const key = getJupiterApiKey();
  try {
    const ids = unique.slice(0, 50).join(",");
    const res = await fetch(`https://api.jup.ag/price/v3?ids=${ids}`, {
      headers: key ? { "x-api-key": key } : {},
    });
    if (!res.ok) {
      console.warn(`[prediction-wallet] price/v3 ${res.status}`);
      return prices;
    }
    const data = (await res.json()) as Record<
      string,
      { usdPrice?: number } | undefined
    >;
    for (const mint of unique) {
      const p = data[mint]?.usdPrice;
      if (typeof p === "number" && Number.isFinite(p) && p > 0) {
        prices.set(mint, p);
      }
    }
  } catch (error) {
    console.warn("[prediction-wallet] price/v3:", error);
  }

  return prices;
}

export async function fetchPredictionWalletSnapshot(): Promise<PredictionWalletSnapshot | null> {
  const address = getTradingSolanaAddress();
  if (!address) return null;

  let sol = 0;
  let spl: SplHolding[] = [];

  try {
    const [solBal, holdings] = await Promise.all([
      fetchSolBalance(address),
      fetchAllSplHoldings(address),
    ]);
    sol = solBal;
    spl = holdings;
  } catch (error) {
    console.warn("[prediction-wallet] rpc balances:", error);
  }

  // Fallback: DAS holdings if RPC returned nothing useful
  if (spl.length === 0) {
    try {
      const holdings = await fetchSolanaWalletHoldings(address, {
        forceRefresh: true,
      });
      if (sol <= 0) sol = holdings.solBalance;
      spl = holdings.fungibleTokens.map((t) => ({
        mint: t.mint,
        symbol: t.symbol || KNOWN_SYMBOLS[t.mint] || t.mint.slice(0, 4),
        amount: t.uiAmount,
        decimals: t.decimals,
      }));
    } catch (error) {
      console.warn("[prediction-wallet] holdings fallback:", error);
    }
  }

  const usdc = spl
    .filter((h) => h.mint === PREDICTION_MINT_USDC)
    .reduce((sum, h) => sum + h.amount, 0);

  const priceMints = [MINT_SOL, ...spl.map((h) => h.mint)];
  const prices = await fetchUsdPrices(priceMints);
  const solPriceUsd = prices.get(MINT_SOL) ?? 0;
  const solValueUsd = sol * solPriceUsd;

  const tokenRows: WalletTokenBalance[] = spl.map((h) => {
    const priceUsd =
      h.mint === PREDICTION_MINT_USDC ||
      h.mint === MINT_USDT ||
      h.mint === MINT_JUPUSD
        ? (prices.get(h.mint) ?? 1)
        : (prices.get(h.mint) ?? 0);
    return {
      mint: h.mint,
      symbol: h.symbol,
      amount: h.amount,
      priceUsd,
      valueUsd: h.amount * priceUsd,
    };
  });

  const tokensValueUsd = tokenRows.reduce((s, t) => s + t.valueUsd, 0);

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

  const topTokens: WalletTokenBalance[] = [
    {
      mint: MINT_SOL,
      symbol: "SOL",
      amount: sol,
      priceUsd: solPriceUsd,
      valueUsd: solValueUsd,
    },
    ...tokenRows,
  ]
    .filter((t) => t.amount > 0)
    .sort((a, b) => b.valueUsd - a.valueUsd)
    .slice(0, 8);

  const totalWorthUsd = solValueUsd + tokensValueUsd + positionValueUsd;

  return {
    address,
    sol,
    usdc,
    solPriceUsd,
    solValueUsd,
    tokensValueUsd,
    positionValueUsd,
    totalWorthUsd,
    openPositions,
    capturedAt: new Date().toISOString(),
    topTokens,
    positions,
  };
}
