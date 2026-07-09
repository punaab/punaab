import {
  createSmartWalletClient,
  alchemyWalletTransport,
  type SmartWalletClient,
} from "@alchemy/wallet-apis";
import { base } from "viem/chains";
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  formatEther,
  http,
  isAddress,
  parseEther,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  getAlchemyApiKey,
  getAlchemyGasPolicyId,
  getAlchemyNftCountCacheSec,
  getEvmAgentPrivateKey,
  getTradingBaseAddress,
  getZeroExApiKey,
  isAlchemyCliTradingEnabled,
  isDryRun,
  isTradingEnabled,
  TRADING_LIMITS,
} from "./config";
import { getCached } from "./alchemy-cache";
import { countNFTsForOwner } from "./alchemy-nft-v3";
import { appendTradeLog, canExecuteTrade, incrementTradesToday, type TradeLogEntry } from "./trading";
import {
  cliEvmSend,
  cliEvmSwapExecute,
  cliEvmSwapQuote,
  isAlchemyCliSessionReady,
} from "./trading-cli";

const BASE_CHAIN_ID = 8453;
const NATIVE_ETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as const;
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

let walletClient: SmartWalletClient | null = null;

function getEvmAccount() {
  const key = getEvmAgentPrivateKey();
  if (!key) return null;
  const normalized = key.startsWith("0x") ? key : `0x${key}`;
  try {
    return privateKeyToAccount(normalized as Hex);
  } catch {
    console.error("[trading-evm] invalid EVM_AGENT_PRIVATE_KEY");
    return null;
  }
}

export function hasEvmTradeSigner(): boolean {
  return getEvmAccount() !== null || isAlchemyCliTradingEnabled();
}

export async function hasEvmTradeSignerAsync(): Promise<boolean> {
  if (getEvmAccount() !== null) return true;
  if (!isAlchemyCliTradingEnabled()) return false;
  return isAlchemyCliSessionReady();
}

function getPublicClient() {
  const apiKey = getAlchemyApiKey();
  const url = apiKey
    ? `https://base-mainnet.g.alchemy.com/v2/${apiKey}`
    : "https://mainnet.base.org";
  return createPublicClient({ chain: base, transport: http(url) });
}

function getWalletClient() {
  if (walletClient) return walletClient;
  const apiKey = getAlchemyApiKey();
  const account = getEvmAccount();
  if (!apiKey || !account) return null;

  const policyId = getAlchemyGasPolicyId();
  walletClient = createSmartWalletClient({
    transport: alchemyWalletTransport({ apiKey }),
    chain: base,
    signer: account,
    ...(policyId ? { paymaster: { policyId } } : {}),
  }) as SmartWalletClient;
  return walletClient;
}

export async function getBaseEthBalance(address?: string): Promise<number> {
  const addr = address ?? getTradingBaseAddress();
  if (!addr || !isAddress(addr)) return 0;
  const wei = await getPublicClient().getBalance({ address: addr as Address });
  return Number(formatEther(wei));
}

export async function fetchBaseNftCount(address: string): Promise<number> {
  const apiKey = getAlchemyApiKey();
  if (!apiKey) return 0;

  return getCached(`moltbook:alchemy:base-nfts:${address}`, getAlchemyNftCountCacheSec(), async () => {
    try {
      return await countNFTsForOwner(apiKey, "base-mainnet", address);
    } catch {
      return 0;
    }
  });
}

interface ZeroExQuote {
  buyAmount: string;
  sellAmount: string;
  transaction: { to: string; data: string; value: string; gas: string };
}

async function fetchZeroExQuote(params: {
  sellToken: string;
  buyToken: string;
  sellAmountWei: bigint;
  takerAddress: string;
}): Promise<ZeroExQuote> {
  const qs = new URLSearchParams({
    chainId: String(BASE_CHAIN_ID),
    sellToken: params.sellToken,
    buyToken: params.buyToken,
    sellAmount: params.sellAmountWei.toString(),
    taker: params.takerAddress,
    slippageBps: String(TRADING_LIMITS.defaultSlippageBps),
  });
  const headers: Record<string, string> = { "0x-version": "v2" };
  const zxKey = getZeroExApiKey();
  if (zxKey) headers["0x-api-key"] = zxKey;

  const res = await fetch(`https://api.0x.org/swap/permit2/quote?${qs}`, { headers });
  if (!res.ok) {
    throw new Error(`0x quote failed: ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()) as ZeroExQuote;
}

export interface EvmSwapParams {
  sellToken?: string;
  buyToken?: string;
  amountEth: number;
  reason?: string;
}

export interface EvmSwapResult {
  ok: boolean;
  dryRun: boolean;
  callId?: string;
  txHash?: string;
  error?: string;
  log: TradeLogEntry;
}

async function executeEvmSwapViaCli(params: {
  sellToken: string;
  buyToken: string;
  amountEth: number;
  reason?: string;
  dryRun: boolean;
}): Promise<EvmSwapResult> {
  if (params.dryRun) {
    const quote = await cliEvmSwapQuote({
      sellToken: params.sellToken,
      buyToken: params.buyToken,
      amount: params.amountEth,
    });
    const log = await appendTradeLog({
      chain: "base",
      action: "swap",
      inputMint: quote.fromToken ?? params.sellToken,
      outputMint: quote.toToken ?? params.buyToken,
      inputAmount: String(params.amountEth),
      outputAmount: quote.minimumOutput,
      reason: params.reason ?? "cli_dry_run",
      dryRun: true,
      error: quote.ok ? undefined : quote.error,
    });
    return { ok: quote.ok, dryRun: true, error: quote.error, log };
  }

  const result = await cliEvmSwapExecute({
    sellToken: params.sellToken,
    buyToken: params.buyToken,
    amount: params.amountEth,
  });

  const log = await appendTradeLog({
    chain: "base",
    action: "swap",
    inputMint: result.fromToken ?? params.sellToken,
    outputMint: result.toToken ?? params.buyToken,
    inputAmount: result.fromAmount ?? String(params.amountEth),
    signature: result.txHash,
    reason: params.reason ?? "cli_session",
    dryRun: false,
    error: result.ok ? undefined : result.error,
  });

  if (result.ok) await incrementTradesToday();

  return {
    ok: result.ok,
    dryRun: false,
    callId: result.callId,
    txHash: result.txHash,
    error: result.error,
    log,
  };
}

async function executeEvmTransferViaCli(
  params: EvmTransferParams & { dryRun: boolean },
): Promise<EvmSwapResult> {
  const amount = String(params.amountEth ?? params.tokenAmount ?? "0");
  const result = await cliEvmSend({
    toAddress: params.toAddress,
    amount,
    tokenAddress: params.tokenAddress,
    dryRun: params.dryRun,
  });

  const log = await appendTradeLog({
    chain: "base",
    action: "transfer",
    inputMint: params.tokenAddress ?? "ETH",
    outputMint: params.toAddress,
    inputAmount: amount,
    signature: result.txHash,
    reason: params.reason ?? "cli_session",
    dryRun: params.dryRun,
    error: result.ok ? undefined : result.error,
  });

  if (result.ok && !params.dryRun) await incrementTradesToday();

  return {
    ok: result.ok,
    dryRun: params.dryRun,
    callId: result.callId,
    txHash: result.txHash,
    error: result.error,
    log,
  };
}

export async function executeEvmSwap(params: EvmSwapParams): Promise<EvmSwapResult> {
  const sellToken = (params.sellToken ?? NATIVE_ETH) as string;
  const buyToken = (params.buyToken ?? USDC_BASE) as string;
  const dryRun = isDryRun();
  const account = getEvmAccount();

  if (!account && isAlchemyCliTradingEnabled()) {
    const sessionReady = await isAlchemyCliSessionReady();
    if (sessionReady) {
      const gate = await canExecuteTrade();
      if (!gate.ok && !dryRun) {
        const log = await appendTradeLog({
          chain: "base",
          action: "swap",
          inputMint: sellToken,
          outputMint: buyToken,
          inputAmount: String(params.amountEth),
          reason: params.reason,
          dryRun: false,
          error: gate.reason,
        });
        return { ok: false, dryRun: false, error: gate.reason, log };
      }
      return executeEvmSwapViaCli({
        sellToken,
        buyToken,
        amountEth: params.amountEth,
        reason: params.reason,
        dryRun,
      });
    }
  }
  const client = getWalletClient();
  const taker = getTradingBaseAddress() ?? account?.address;

  const gate = await canExecuteTrade();
  if (!gate.ok && !dryRun) {
    const log = await appendTradeLog({
      chain: "base",
      action: "swap",
      inputMint: sellToken,
      outputMint: buyToken,
      inputAmount: String(params.amountEth),
      reason: params.reason,
      dryRun: false,
      error: gate.reason,
    });
    return { ok: false, dryRun: false, error: gate.reason, log };
  }

  if (!taker || !account) {
    const log = await appendTradeLog({
      chain: "base",
      action: "swap",
      inputMint: sellToken,
      outputMint: buyToken,
      inputAmount: String(params.amountEth),
      reason: params.reason,
      dryRun: true,
      error: "no_evm_signer",
    });
    return { ok: false, dryRun: true, error: "no_evm_signer", log };
  }

  const balance = await getBaseEthBalance(taker);
  const maxEth = Math.min(
    TRADING_LIMITS.maxEthPerTrade,
    Math.max(0, balance - TRADING_LIMITS.minEthReserve),
  );
  if (params.amountEth > maxEth) {
    const error = `amount_exceeds_limit (max ${maxEth.toFixed(6)} ETH)`;
    const log = await appendTradeLog({
      chain: "base",
      action: "swap",
      inputMint: sellToken,
      outputMint: buyToken,
      inputAmount: String(params.amountEth),
      reason: params.reason,
      dryRun,
      error,
    });
    return { ok: false, dryRun, error, log };
  }

  const sellAmountWei = parseEther(String(params.amountEth));
  let quote: ZeroExQuote;
  try {
    quote = await fetchZeroExQuote({
      sellToken,
      buyToken,
      sellAmountWei,
      takerAddress: taker,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "quote_failed";
    const log = await appendTradeLog({
      chain: "base",
      action: "quote",
      inputMint: sellToken,
      outputMint: buyToken,
      inputAmount: String(params.amountEth),
      reason: params.reason,
      dryRun,
      error: message,
    });
    return { ok: false, dryRun, error: message, log };
  }

  if (dryRun || !client) {
    const log = await appendTradeLog({
      chain: "base",
      action: "swap",
      inputMint: sellToken,
      outputMint: buyToken,
      inputAmount: quote.sellAmount,
      outputAmount: quote.buyAmount,
      reason: params.reason ?? "dry_run",
      dryRun: true,
    });
    return { ok: true, dryRun: true, log };
  }

  try {
    const { id } = await client.sendCalls({
      calls: [
        {
          to: quote.transaction.to as Address,
          data: quote.transaction.data as Hex,
          value: BigInt(quote.transaction.value),
        },
      ],
    });
    const status = await client.waitForCallsStatus({ id });
    const txHash =
      status.status === "success" && status.receipts?.[0]?.transactionHash
        ? status.receipts[0].transactionHash
        : undefined;

    const log = await appendTradeLog({
      chain: "base",
      action: "swap",
      inputMint: sellToken,
      outputMint: buyToken,
      inputAmount: quote.sellAmount,
      outputAmount: quote.buyAmount,
      signature: txHash,
      reason: params.reason,
      dryRun: false,
    });
    if (status.status === "success") await incrementTradesToday();
    return { ok: status.status === "success", dryRun: false, callId: id, txHash, log };
  } catch (error) {
    const message = error instanceof Error ? error.message : "swap_failed";
    const log = await appendTradeLog({
      chain: "base",
      action: "swap",
      inputMint: sellToken,
      outputMint: buyToken,
      inputAmount: quote.sellAmount,
      outputAmount: quote.buyAmount,
      reason: params.reason,
      dryRun: false,
      error: message,
    });
    return { ok: false, dryRun: false, error: message, log };
  }
}

export interface EvmTransferParams {
  toAddress: string;
  amountEth?: number;
  tokenAddress?: string;
  tokenAmount?: string;
  reason?: string;
}

export async function executeEvmTransfer(params: EvmTransferParams): Promise<EvmSwapResult> {
  const dryRun = isDryRun();
  const account = getEvmAccount();

  if (!isAddress(params.toAddress)) {
    const log = await appendTradeLog({
      chain: "base",
      action: "transfer",
      inputMint: params.tokenAddress ?? "ETH",
      outputMint: params.toAddress,
      inputAmount: String(params.amountEth ?? params.tokenAmount ?? "0"),
      reason: params.reason,
      dryRun,
      error: "invalid_to_address",
    });
    return { ok: false, dryRun, error: "invalid_to_address", log };
  }

  const gate = await canExecuteTrade();
  if (!gate.ok && !dryRun) {
    const log = await appendTradeLog({
      chain: "base",
      action: "transfer",
      inputMint: params.tokenAddress ?? "ETH",
      outputMint: params.toAddress,
      inputAmount: String(params.amountEth ?? params.tokenAmount ?? "0"),
      reason: params.reason,
      dryRun: false,
      error: gate.reason,
    });
    return { ok: false, dryRun: false, error: gate.reason, log };
  }

  if (!account && isAlchemyCliTradingEnabled()) {
    const sessionReady = await isAlchemyCliSessionReady();
    if (sessionReady) {
      return executeEvmTransferViaCli({ ...params, dryRun });
    }
  }

  const client = getWalletClient();

  if (dryRun || !client || !account) {
    const log = await appendTradeLog({
      chain: "base",
      action: "transfer",
      inputMint: params.tokenAddress ?? "ETH",
      outputMint: params.toAddress,
      inputAmount: String(params.amountEth ?? params.tokenAmount ?? "0"),
      reason: params.reason ?? "dry_run",
      dryRun: true,
    });
    return { ok: true, dryRun: true, log };
  }

  try {
    const calls =
      params.tokenAddress && isAddress(params.tokenAddress)
        ? [
            {
              to: params.tokenAddress as Address,
              data: encodeFunctionData({
                abi: erc20Abi,
                functionName: "transfer",
                args: [
                  params.toAddress as Address,
                  parseUnits(params.tokenAmount ?? "0", 6),
                ],
              }),
            },
          ]
        : [
            {
              to: params.toAddress as Address,
              value: parseEther(String(params.amountEth ?? 0)),
            },
          ];

    const { id } = await client.sendCalls({ calls });
    const status = await client.waitForCallsStatus({ id });
    const txHash = status.receipts?.[0]?.transactionHash;

    const log = await appendTradeLog({
      chain: "base",
      action: "transfer",
      inputMint: params.tokenAddress ?? "ETH",
      outputMint: params.toAddress,
      inputAmount: String(params.amountEth ?? params.tokenAmount ?? "0"),
      signature: txHash,
      reason: params.reason,
      dryRun: false,
    });
    if (status.status === "success") await incrementTradesToday();
    return { ok: status.status === "success", dryRun: false, callId: id, txHash, log };
  } catch (error) {
    const message = error instanceof Error ? error.message : "transfer_failed";
    const log = await appendTradeLog({
      chain: "base",
      action: "transfer",
      inputMint: params.tokenAddress ?? "ETH",
      outputMint: params.toAddress,
      inputAmount: String(params.amountEth ?? params.tokenAmount ?? "0"),
      reason: params.reason,
      dryRun: false,
      error: message,
    });
    return { ok: false, dryRun: false, error: message, log };
  }
}

export async function analyzeEvmOpportunity(): Promise<{
  address: string;
  ethBalance: number;
  nftCount: number;
  recommendation: string;
} | null> {
  if (!isTradingEnabled()) return null;
  const address = getTradingBaseAddress();
  if (!address) return null;

  const [ethBalance, nftCount] = await Promise.all([
    getBaseEthBalance(address),
    fetchBaseNftCount(address),
  ]);

  const tradeable = Math.min(
    TRADING_LIMITS.maxEthPerTrade,
    Math.max(0, ethBalance - TRADING_LIMITS.minEthReserve),
  );

  const recommendation =
    tradeable > 0
      ? `Base: ${ethBalance.toFixed(4)} ETH, ${nftCount} NFTs. Can swap ~${tradeable.toFixed(4)} ETH via 0x.`
      : `Base balance low (${ethBalance.toFixed(4)} ETH). ${nftCount} NFTs held.`;

  return { address, ethBalance, nftCount, recommendation };
}
