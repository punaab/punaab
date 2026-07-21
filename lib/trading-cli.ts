/**
 * Local Alchemy CLI session trading — no wallet private keys in env.
 * Requires: `alchemy wallet connect --mode session` on this machine.
 * Disabled on Vercel by default (no CLI session there).
 */
import { runAlchemyCli } from "./alchemy-cli";
import {
  getAlchemyGasPolicyId,
  isAlchemyCliTradingEnabled,
  TRADING_LIMITS,
} from "./config";

const BASE_NETWORK = "base-mainnet";
const NATIVE_ETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const SESSION_CACHE_MS = 60_000;

interface SessionCache {
  ready: boolean;
  at: number;
  evm?: string;
  solana?: string;
}

let sessionCache: SessionCache | null = null;

function parseCliError(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const record = data as Record<string, unknown>;
  const err = record.error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (typeof e.message === "string") return e.message;
  }
  return undefined;
}

function sessionLooksActive(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  if (d.valid === true || d.verified === true) return true;
  if (d.status === "active" || d.status === "approved") return true;
  if (d.sessionState === "approved" || d.remoteStatus === "approved") return true;
  const session = d.session;
  if (session && typeof session === "object") {
    const s = session as Record<string, unknown>;
    if (s.valid === true || s.sessionState === "approved" || s.status === "active") {
      return true;
    }
  }
  const sessions = d.sessionsByChain as
    | Record<string, { status?: string; walletAddress?: string }>
    | undefined;
  if (sessions?.evm) {
    const st = (sessions.evm.status || "").toLowerCase();
    if (st === "active" || st === "approved" || st === "connected") return true;
    if (sessions.evm.walletAddress) return true; // address present ⇒ session usable
  }
  return d.activeSigner === "session";
}

export async function isAlchemyCliSessionReady(): Promise<boolean> {
  if (!isAlchemyCliTradingEnabled()) return false;

  if (sessionCache && Date.now() - sessionCache.at < SESSION_CACHE_MS) {
    return sessionCache.ready;
  }

  const result = await runAlchemyCli(["wallet", "status", "--verify"]);
  const ready = result.ok && sessionLooksActive(result.data);
  const data = (result.data ?? {}) as Record<string, unknown>;
  const sessions = data.sessionsByChain as Record<string, { walletAddress?: string }> | undefined;

  sessionCache = {
    ready,
    at: Date.now(),
    evm: sessions?.evm?.walletAddress ?? (typeof data.walletAddress === "string" ? data.walletAddress : undefined),
    solana: sessions?.solana?.walletAddress,
  };

  return ready;
}

export function getCachedCliSessionAddresses(): { evm?: string; solana?: string } {
  return { evm: sessionCache?.evm, solana: sessionCache?.solana };
}

export async function resolveEvmTokenAddress(
  symbolOrAddress: string,
  network = BASE_NETWORK,
): Promise<string> {
  const trimmed = symbolOrAddress.trim();
  if (/^0x[0-9a-fA-F]{40}$/i.test(trimmed)) return trimmed;
  if (/^0x[eE]{40}$/i.test(trimmed) || trimmed.toLowerCase() === "native") {
    return NATIVE_ETH;
  }

  const result = await runAlchemyCli(["evm", "token", trimmed, "-n", network]);
  if (!result.ok || !result.data) {
    throw new Error(result.error ?? `unknown_token:${trimmed}`);
  }
  const data = result.data as Record<string, unknown>;
  if (typeof data.address === "string") return data.address;
  throw new Error(`token_resolve_failed:${trimmed}`);
}

function slippagePercent(): string {
  return String(TRADING_LIMITS.defaultSlippageBps / 100);
}

function gasCliArgs(): string[] {
  const policyId = getAlchemyGasPolicyId();
  if (!policyId) return [];
  return ["--gas-sponsored", "--gas-policy-id", policyId];
}

export interface CliSwapResult {
  ok: boolean;
  txHash?: string;
  callId?: string;
  status?: string;
  fromToken?: string;
  toToken?: string;
  fromAmount?: string;
  minimumOutput?: string;
  error?: string;
}

export async function cliEvmSwapQuote(params: {
  sellToken: string;
  buyToken: string;
  amount: number;
}): Promise<CliSwapResult> {
  let from: string;
  let to: string;
  try {
    from = await resolveEvmTokenAddress(params.sellToken);
    to = await resolveEvmTokenAddress(params.buyToken);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "token_resolve_failed",
    };
  }

  const result = await runAlchemyCli([
    "evm",
    "swap",
    "quote",
    "--from",
    from,
    "--to",
    to,
    "--amount",
    String(params.amount),
    "--slippage",
    slippagePercent(),
    "--signer",
    "session",
    "-n",
    BASE_NETWORK,
  ]);

  if (!result.ok) {
    return { ok: false, error: result.error ?? parseCliError(result.data) };
  }

  const data = result.data as Record<string, unknown>;
  return {
    ok: true,
    fromToken: from,
    toToken: to,
    fromAmount: String(params.amount),
    minimumOutput:
      typeof data.minimumOutput === "string" ? data.minimumOutput : undefined,
  };
}

export async function cliEvmSwapExecute(params: {
  sellToken: string;
  buyToken: string;
  amount: number;
}): Promise<CliSwapResult> {
  let from: string;
  let to: string;
  try {
    from = await resolveEvmTokenAddress(params.sellToken);
    to = await resolveEvmTokenAddress(params.buyToken);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "token_resolve_failed",
    };
  }

  const result = await runAlchemyCli(
    [
      "evm",
      "swap",
      "execute",
      "--from",
      from,
      "--to",
      to,
      "--amount",
      String(params.amount),
      "--slippage",
      slippagePercent(),
      "--signer",
      "session",
      "-n",
      BASE_NETWORK,
      ...gasCliArgs(),
    ],
    { timeoutMs: 300_000 },
  );

  if (!result.ok) {
    return {
      ok: false,
      fromToken: from,
      toToken: to,
      fromAmount: String(params.amount),
      error: result.error ?? parseCliError(result.data) ?? "cli_swap_failed",
    };
  }

  const data = result.data as Record<string, unknown>;
  return {
    ok: typeof data.status === "string" ? data.status === "success" : true,
    txHash: typeof data.txHash === "string" ? data.txHash : undefined,
    callId: typeof data.callId === "string" ? data.callId : undefined,
    status: typeof data.status === "string" ? data.status : undefined,
    fromToken: from,
    toToken: to,
    fromAmount: String(params.amount),
  };
}

export interface CliSendResult {
  ok: boolean;
  txHash?: string;
  callId?: string;
  status?: string;
  error?: string;
}

export async function cliEvmSend(params: {
  toAddress: string;
  amount: string;
  tokenAddress?: string;
  dryRun?: boolean;
}): Promise<CliSendResult> {
  const args = [
    "evm",
    "send",
    params.toAddress,
    params.amount,
    "--signer",
    "session",
    "-n",
    BASE_NETWORK,
    ...gasCliArgs(),
  ];

  if (params.tokenAddress) {
    try {
      const token = await resolveEvmTokenAddress(params.tokenAddress);
      args.push("--token", token);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "token_resolve_failed",
      };
    }
  }

  if (params.dryRun) {
    args.push("--dry-run");
  }

  const result = await runAlchemyCli(args, { timeoutMs: 180_000 });
  if (!result.ok) {
    return { ok: false, error: result.error ?? parseCliError(result.data) ?? "cli_send_failed" };
  }

  const data = result.data as Record<string, unknown>;
  return {
    ok: true,
    txHash: typeof data.txHash === "string" ? data.txHash : undefined,
    callId: typeof data.callId === "string" ? data.callId : undefined,
    status: typeof data.status === "string" ? data.status : undefined,
  };
}

export async function cliSolanaSend(params: {
  toAddress: string;
  amount: number;
  tokenMint?: string;
  dryRun?: boolean;
}): Promise<CliSendResult> {
  const args = [
    "solana",
    "send",
    params.toAddress,
    String(params.amount),
    "--signer",
    "session",
    "-n",
    "solana-mainnet",
  ];

  if (params.tokenMint) {
    args.push("--token", params.tokenMint);
  }
  if (params.dryRun) {
    args.push("--dry-run");
  }

  const result = await runAlchemyCli(args, { timeoutMs: 180_000 });
  if (!result.ok) {
    return {
      ok: false,
      error: result.error ?? parseCliError(result.data) ?? "cli_solana_send_failed",
    };
  }

  const data = result.data as Record<string, unknown>;
  return {
    ok: true,
    txHash:
      typeof data.txHash === "string"
        ? data.txHash
        : typeof data.signature === "string"
          ? data.signature
          : undefined,
    status: typeof data.status === "string" ? data.status : undefined,
  };
}
