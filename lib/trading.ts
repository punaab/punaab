import {
  Connection,
  Keypair,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import {
  getEvmAgentPrivateKey,
  getSolanaAgentPrivateKey,
  getTradingSolanaAddress,
  isDryRun,
  isTradingEnabled,
  TRADING_LIMITS,
} from "./config";
import {
  fetchSolanaWalletHoldings,
  getAlchemyConnection,
  getSolBalanceViaAlchemy,
  toTokenBaseUnits,
  type SolanaFungibleHolding,
} from "./solana-alchemy";
import { createRedisClient } from "./redis";

const TRADE_LOG_KEY = "moltbook:trading:log";
const TRADES_TODAY_KEY = "moltbook:trading:trades_today";
const MAX_TRADE_LOG = 50;

/** Wrapped SOL on Solana mainnet */
export const MINT_SOL = "So11111111111111111111111111111111111111112";
export const MINT_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const MINT_USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

export interface TradeLogEntry {
  id: string;
  timestamp: string;
  chain?: "solana" | "base";
  action: "quote" | "swap" | "transfer" | "nft" | "analyze";
  inputMint: string;
  outputMint: string;
  inputAmount: string;
  outputAmount?: string;
  signature?: string;
  reason?: string;
  dryRun: boolean;
  error?: string;
}

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: string;
  routePlan: unknown[];
}

export interface TradeAnalysis {
  wallet: string;
  solBalance: number;
  holdings?: SolanaFungibleHolding[];
  solNftCount?: number;
  baseBalance?: number;
  baseNftCount?: number;
  quotes: Array<{
    pair: string;
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    priceImpactPct: string;
  }>;
  recommendation: string;
}

let redis: ReturnType<typeof createRedisClient> | null = null;
function getRedis() {
  if (!redis) redis = createRedisClient();
  return redis;
}

function getConnection(): Connection {
  return getAlchemyConnection();
}

function isNativeSolMint(mint: string): boolean {
  return mint === MINT_SOL || mint === "SOL";
}

async function resolveInputAmountLimit(params: {
  inputMint: string;
  holdings: Awaited<ReturnType<typeof fetchSolanaWalletHoldings>>;
}): Promise<{ maxUi: number; decimals: number; balanceRaw: bigint }> {
  const { inputMint, holdings } = params;

  if (isNativeSolMint(inputMint)) {
    const maxUi = Math.min(
      TRADING_LIMITS.maxSolPerTrade,
      Math.max(0, holdings.solBalance - TRADING_LIMITS.minSolReserve),
    );
    return {
      maxUi,
      decimals: 9,
      balanceRaw: BigInt(holdings.lamports),
    };
  }

  const token = holdings.fungibleTokens.find((t) => t.mint === inputMint);
  if (!token) {
    return { maxUi: 0, decimals: 0, balanceRaw: BigInt(0) };
  }

  // Up to 50% of any SPL balance per trade (no fixed SOL-style cap for alt tokens)
  const maxUi = token.uiAmount * 0.5;
  return {
    maxUi,
    decimals: token.decimals,
    balanceRaw: BigInt(token.balanceRaw),
  };
}

function getSigner(): Keypair | null {
  const secret = getSolanaAgentPrivateKey();
  if (!secret) return null;
  try {
    const decoded = bs58.decode(secret);
    return Keypair.fromSecretKey(decoded);
  } catch {
    try {
      const bytes = JSON.parse(secret) as number[];
      return Keypair.fromSecretKey(Uint8Array.from(bytes));
    } catch {
      console.error("[trading] invalid SOLANA_AGENT_PRIVATE_KEY");
      return null;
    }
  }
}

export function hasTradeSigner(): boolean {
  return getSigner() !== null;
}

export function hasAnyTradeSigner(): boolean {
  return getSigner() !== null || !!getEvmAgentPrivateKey();
}

export async function getSolBalance(address?: string): Promise<number> {
  const wallet = address ?? getTradingSolanaAddress();
  if (!wallet) return 0;
  return getSolBalanceViaAlchemy(wallet);
}

export async function getJupiterQuote(params: {
  inputMint: string;
  outputMint: string;
  amountRaw: bigint | number;
  slippageBps?: number;
}): Promise<JupiterQuote> {
  const slippage = params.slippageBps ?? TRADING_LIMITS.defaultSlippageBps;
  const url = new URL("https://quote-api.jup.ag/v6/quote");
  url.searchParams.set("inputMint", params.inputMint);
  url.searchParams.set("outputMint", params.outputMint);
  url.searchParams.set("amount", String(params.amountRaw));
  url.searchParams.set("slippageBps", String(slippage));

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Jupiter quote failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return (await res.json()) as JupiterQuote;
}

export async function analyzeTradingOpportunity(): Promise<TradeAnalysis | null> {
  if (!isTradingEnabled()) return null;

  const wallet = getTradingSolanaAddress();
  if (!wallet) return null;

  const holdings = await fetchSolanaWalletHoldings(wallet);
  const solBalance = holdings.solBalance;
  const solNftCount = holdings.nftCount;

  const quoteTargets = [
    { mint: MINT_USDC, label: "USDC" },
    { mint: MINT_USDT, label: "USDT" },
  ];

  const swapCandidates: Array<{
    label: string;
    mint: string;
    uiAmount: number;
    decimals: number;
  }> = [];

  const tradeSol = Math.min(
    TRADING_LIMITS.maxSolPerTrade,
    Math.max(0, solBalance - TRADING_LIMITS.minSolReserve),
  );
  if (tradeSol > 0) {
    swapCandidates.push({
      label: "SOL",
      mint: MINT_SOL,
      uiAmount: tradeSol,
      decimals: 9,
    });
  }

  for (const token of holdings.fungibleTokens.slice(0, 8)) {
    if (token.mint === MINT_USDC || token.mint === MINT_USDT) continue;
    const tradeUi = token.uiAmount * 0.25;
    if (tradeUi > 0) {
      swapCandidates.push({
        label: token.symbol,
        mint: token.mint,
        uiAmount: tradeUi,
        decimals: token.decimals,
      });
    }
  }

  const quotes: TradeAnalysis["quotes"] = [];
  for (const candidate of swapCandidates.slice(0, 4)) {
    for (const target of quoteTargets) {
      if (candidate.mint === target.mint) continue;
      try {
        const amountRaw = toTokenBaseUnits(candidate.uiAmount, candidate.decimals);
        if (amountRaw <= BigInt(0)) continue;
        const q = await getJupiterQuote({
          inputMint: candidate.mint,
          outputMint: target.mint,
          amountRaw,
        });
        quotes.push({
          pair: `${candidate.label}→${target.label}`,
          inputMint: candidate.mint,
          outputMint: target.mint,
          inAmount: q.inAmount,
          outAmount: q.outAmount,
          priceImpactPct: q.priceImpactPct,
        });
      } catch (error) {
        console.warn(`[trading] quote ${candidate.label}→${target.label} failed:`, error);
      }
    }
  }

  quotes.sort((a, b) => Number(b.outAmount) - Number(a.outAmount));
  const best = quotes[0];

  const tokenSummary =
    holdings.fungibleTokens.length > 0
      ? holdings.fungibleTokens
          .slice(0, 5)
          .map((t) => `${t.uiAmount.toFixed(4)} ${t.symbol}`)
          .join(", ")
      : "no SPL tokens";

  let recommendation = best
    ? `Solana wallet: ${solBalance.toFixed(4)} SOL, tokens: ${tokenSummary}, ${solNftCount} NFTs. Best route ${best.pair} impact ${best.priceImpactPct}%.`
    : `Solana: ${solBalance.toFixed(4)} SOL, tokens: ${tokenSummary}, ${solNftCount} NFTs. No Jupiter routes right now.`;

  try {
    const { analyzeEvmOpportunity } = await import("./trading-evm");
    const evm = await analyzeEvmOpportunity();
    if (evm) {
      recommendation += ` ${evm.recommendation}`;
      return {
        wallet,
        solBalance,
        holdings: holdings.fungibleTokens,
        solNftCount,
        baseBalance: evm.ethBalance,
        baseNftCount: evm.nftCount,
        quotes,
        recommendation,
      };
    }
  } catch {
    // optional
  }

  return {
    wallet,
    solBalance,
    holdings: holdings.fungibleTokens,
    solNftCount,
    quotes,
    recommendation,
  };
}

async function getTradesToday(): Promise<number> {
  try {
    const raw = await getRedis().get<string>(TRADES_TODAY_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { date: string; count: number };
    const today = new Date().toISOString().slice(0, 10);
    return parsed.date === today ? parsed.count : 0;
  } catch {
    return 0;
  }
}

export async function incrementTradesToday(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const count = (await getTradesToday()) + 1;
  await getRedis().set(TRADES_TODAY_KEY, JSON.stringify({ date: today, count }));
}

export async function canExecuteTrade(): Promise<{ ok: boolean; reason?: string }> {
  if (!isTradingEnabled()) {
    return { ok: false, reason: "trading_disabled" };
  }
  if (!hasAnyTradeSigner()) {
    return { ok: false, reason: "no_signer" };
  }
  const tradesToday = await getTradesToday();
  if (tradesToday >= TRADING_LIMITS.maxTradesPerDay) {
    return { ok: false, reason: "daily_limit_reached" };
  }
  return { ok: true };
}

export async function appendTradeLog(
  entry: Omit<TradeLogEntry, "id" | "timestamp">,
): Promise<TradeLogEntry> {
  const full: TradeLogEntry = {
    ...entry,
    id: `trade_${Date.now()}`,
    timestamp: new Date().toISOString(),
  };
  try {
    const r = getRedis();
    await r.lpush(TRADE_LOG_KEY, JSON.stringify(full));
    await r.ltrim(TRADE_LOG_KEY, 0, MAX_TRADE_LOG - 1);
  } catch (error) {
    console.error("[trading] appendTradeLog failed:", error);
  }
  return full;
}

export async function getTradeLog(limit = 20): Promise<TradeLogEntry[]> {
  try {
    const items = await getRedis().lrange(TRADE_LOG_KEY, 0, limit - 1);
    return (Array.isArray(items) ? items : [])
      .map((item) => {
        try {
          return JSON.parse(String(item)) as TradeLogEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is TradeLogEntry => e !== null);
  } catch {
    return [];
  }
}

export interface SwapParams {
  inputMint?: string;
  outputMint: string;
  /** Human-readable amount in the input token (SOL if inputMint is native). */
  amountSol: number;
  slippageBps?: number;
  reason?: string;
}

export interface SwapResult {
  ok: boolean;
  dryRun: boolean;
  signature?: string;
  quote?: JupiterQuote;
  error?: string;
  log: TradeLogEntry;
}

export async function executeSwap(params: SwapParams): Promise<SwapResult> {
  const inputMint = params.inputMint ?? MINT_SOL;
  const wallet = getTradingSolanaAddress();
  const signer = getSigner();
  const dryRun = isDryRun();

  const gate = await canExecuteTrade();
  if (!gate.ok && !dryRun) {
    const log = await appendTradeLog({
      chain: "solana",
      action: "swap",
      inputMint,
      outputMint: params.outputMint,
      inputAmount: String(params.amountSol),
      reason: params.reason,
      dryRun: false,
      error: gate.reason,
    });
    return { ok: false, dryRun: false, error: gate.reason, log };
  }

  if (!wallet) {
    const log = await appendTradeLog({
      chain: "solana",
      action: "swap",
      inputMint,
      outputMint: params.outputMint,
      inputAmount: String(params.amountSol),
      reason: params.reason,
      dryRun: true,
      error: "no_wallet",
    });
    return { ok: false, dryRun: true, error: "no_wallet", log };
  }

  const holdings = await fetchSolanaWalletHoldings(wallet);
  const { maxUi, decimals } = await resolveInputAmountLimit({
    inputMint,
    holdings,
  });

  if (maxUi <= 0) {
    const error = isNativeSolMint(inputMint)
      ? `insufficient_sol (need > ${TRADING_LIMITS.minSolReserve} reserve)`
      : "insufficient_token_balance";
    const log = await appendTradeLog({
      chain: "solana",
      action: "swap",
      inputMint,
      outputMint: params.outputMint,
      inputAmount: String(params.amountSol),
      reason: params.reason,
      dryRun,
      error,
    });
    return { ok: false, dryRun, error, log };
  }

  if (params.amountSol > maxUi) {
    const error = `amount_exceeds_limit (max ${maxUi.toFixed(6)} of input token)`;
    const log = await appendTradeLog({
      chain: "solana",
      action: "swap",
      inputMint,
      outputMint: params.outputMint,
      inputAmount: String(params.amountSol),
      reason: params.reason,
      dryRun,
      error,
    });
    return { ok: false, dryRun, error, log };
  }

  const amountRaw = toTokenBaseUnits(params.amountSol, decimals);
  let quote: JupiterQuote;
  try {
    quote = await getJupiterQuote({
      inputMint,
      outputMint: params.outputMint,
      amountRaw,
      slippageBps: params.slippageBps,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "quote_failed";
    const log = await appendTradeLog({
      chain: "solana",
      action: "quote",
      inputMint,
      outputMint: params.outputMint,
      inputAmount: String(params.amountSol),
      reason: params.reason,
      dryRun,
      error: message,
    });
    return { ok: false, dryRun, error: message, log };
  }

  if (dryRun || !signer) {
    const log = await appendTradeLog({
      chain: "solana",
      action: "swap",
      inputMint,
      outputMint: params.outputMint,
      inputAmount: quote.inAmount,
      outputAmount: quote.outAmount,
      reason: params.reason ?? (signer ? "dry_run" : "no_signer"),
      dryRun: true,
    });
    return { ok: true, dryRun: true, quote, log };
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
      throw new Error(`Jupiter swap build failed: ${await swapRes.text()}`);
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
    await incrementTradesToday();

    const log = await appendTradeLog({
      chain: "solana",
      action: "swap",
      inputMint,
      outputMint: params.outputMint,
      inputAmount: quote.inAmount,
      outputAmount: quote.outAmount,
      signature,
      reason: params.reason,
      dryRun: false,
    });

    return { ok: true, dryRun: false, signature, quote, log };
  } catch (error) {
    const message = error instanceof Error ? error.message : "swap_failed";
    const log = await appendTradeLog({
      chain: "solana",
      action: "swap",
      inputMint,
      outputMint: params.outputMint,
      inputAmount: quote.inAmount,
      outputAmount: quote.outAmount,
      reason: params.reason,
      dryRun: false,
      error: message,
    });
    return { ok: false, dryRun: false, quote, error: message, log };
  }
}
