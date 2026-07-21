/**
 * Bridge Arbitrum USDC → Solana USDC via deBridge DLN.
 *
 * Dry-run (default): quote only.
 * Execute: needs a live Alchemy CLI session for the funded EVM wallet
 *   (`alchemy wallet connect`), OR `EVM_AGENT_PRIVATE_KEY` for that address.
 *
 * Usage:
 *   npx tsx scripts/bridge-arb-usdc-to-sol.ts
 *   npx tsx scripts/bridge-arb-usdc-to-sol.ts --execute --amount 240
 */
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatEther,
  formatUnits,
  http,
  parseEther,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum } from "viem/chains";
import { runAlchemyCli } from "../lib/alchemy-cli";
import {
  getCachedCliSessionAddresses,
  isAlchemyCliSessionReady,
} from "../lib/trading-cli";

function loadEnv(name: string) {
  const p = resolve(process.cwd(), name);
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    process.env[k] = v;
  }
}

loadEnv(".env");

const USDC_ARB = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as Address;
const SOLANA_CHAIN_ID = 7565164;
const ARB_CHAIN_ID = 42161;
const USDC_SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const DEFAULT_EVM = "0x310648bd5ad77b4a4dd8725d53902d52e475ec73";
/** Alchemy Agent Wallet Solana — Forecast cannot sign from here */
const ALCHEMY_SOL_SESSION = "6VoBMcEgfdWSCBYBJ46QkzyHiZ2S4WU6YWRdej5zUbhZ";
const FORECAST_HOT_DEFAULT = "4vXgHk3WNd5of5JmfX9upzeDb7RzA6SwBzgXzsYGtKHA";

const execute = process.argv.includes("--execute");
const amountIdx = process.argv.indexOf("--amount");
const amountUsdc =
  amountIdx >= 0 && process.argv[amountIdx + 1]
    ? Number(process.argv[amountIdx + 1])
    : 235;
const toIdx = process.argv.indexOf("--to");
const toOverride =
  toIdx >= 0 && process.argv[toIdx + 1] ? process.argv[toIdx + 1]!.trim() : "";

function getSolRecipient(): string {
  // Prefer Forecast hot wallet — Jupiter prediction signs here, not Alchemy Sol session
  if (toOverride) return toOverride;
  const trading = process.env.TRADING_SOLANA_ADDRESS?.trim();
  if (trading && trading !== ALCHEMY_SOL_SESSION) return trading;
  return FORECAST_HOT_DEFAULT;
}

function arbRpc(): string {
  const key = process.env.ALCHEMY_API_KEY?.trim();
  return key
    ? `https://arb-mainnet.g.alchemy.com/v2/${key}`
    : "https://arb1.arbitrum.io/rpc";
}

async function getSessionEvm(): Promise<{
  ready: boolean;
  address?: string;
  status?: string;
}> {
  const ready = await isAlchemyCliSessionReady();
  const cached = getCachedCliSessionAddresses();
  if (ready || cached.evm) {
    return {
      ready,
      address: cached.evm ?? DEFAULT_EVM,
      status: ready ? "active" : "unknown",
    };
  }

  // Fallback parse (status without --verify)
  const result = await runAlchemyCli(["wallet", "status"]);
  if (!result.ok || !result.data || typeof result.data !== "object") {
    return { ready: false, status: "unavailable" };
  }
  const d = result.data as Record<string, unknown>;
  const sessions = d.sessionsByChain as
    | Record<string, { walletAddress?: string; status?: string }>
    | undefined;
  const address =
    sessions?.evm?.walletAddress ??
    (typeof d.walletAddress === "string" ? d.walletAddress : undefined);
  const st =
    (sessions?.evm?.status as string | undefined) ??
    (typeof d.status === "string" ? d.status : undefined) ??
    (typeof d.sessionState === "string" ? d.sessionState : undefined);
  const looksReady =
    d.valid === true ||
    d.verified === true ||
    st === "active" ||
    st === "approved" ||
    Boolean(address);
  return {
    ready: looksReady,
    address: address ?? DEFAULT_EVM,
    status: st,
  };
}

interface DebridgeCreateTx {
  estimation?: {
    dstChainTokenOut?: { amount?: string; approximateUsdValue?: number };
    srcChainTokenIn?: { amount?: string; approximateUsdValue?: number };
  };
  tx?: { to?: string; data?: string; value?: string };
  orderId?: string;
  fixFee?: string;
  errorMessage?: string;
}

async function createDebridgeTx(params: {
  amountRaw: string;
  evm: string;
  sol: string;
}): Promise<DebridgeCreateTx> {
  const q = new URLSearchParams({
    srcChainId: String(ARB_CHAIN_ID),
    srcChainTokenIn: USDC_ARB,
    srcChainTokenInAmount: params.amountRaw,
    dstChainId: String(SOLANA_CHAIN_ID),
    dstChainTokenOut: USDC_SOL,
    dstChainTokenOutAmount: "auto",
    dstChainTokenOutRecipient: params.sol,
    srcChainOrderAuthorityAddress: params.evm,
    dstChainOrderAuthorityAddress: params.sol,
    prependOperatingExpense: "true",
  });
  const res = await fetch(
    `https://dln.debridge.finance/v1.0/dln/order/create-tx?${q}`,
  );
  return (await res.json()) as DebridgeCreateTx;
}

async function main() {
  const sol = getSolRecipient();
  if (!sol) {
    console.error("Set TRADING_SOLANA_ADDRESS in .env (Forecast hot wallet)");
    process.exit(1);
  }
  if (sol === ALCHEMY_SOL_SESSION && !toOverride) {
    console.error(
      "Refusing to bridge to Alchemy Solana session wallet — Forecast cannot sign there.\n" +
        `Use TRADING_SOLANA_ADDRESS (${FORECAST_HOT_DEFAULT}) or pass --to <pubkey> explicitly.`,
    );
    process.exit(1);
  }

  const session = await getSessionEvm();
  const key = process.env.EVM_AGENT_PRIVATE_KEY?.trim();
  const account = key
    ? privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex)
    : null;

  const evm =
    account?.address ??
    session.address ??
    process.env.ALCHEMY_WALLET_EVM?.trim() ??
    DEFAULT_EVM;

  const publicClient = createPublicClient({
    chain: arbitrum,
    transport: http(arbRpc()),
  });

  const [ethBal, usdcRaw] = await Promise.all([
    publicClient.getBalance({ address: evm as Address }),
    publicClient.readContract({
      address: USDC_ARB,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [evm as Address],
    }),
  ]);

  const usdcBal = Number(formatUnits(usdcRaw, 6));
  const amount = Math.min(amountUsdc, Math.floor(usdcBal * 100) / 100);
  const amountRaw = parseUnits(String(amount), 6).toString();

  console.log(
    JSON.stringify(
      {
        mode: execute ? "execute" : "dry-run",
        evm,
        sol,
        arbEth: Number(formatEther(ethBal)),
        arbUsdc: usdcBal,
        bridgeAmount: amount,
        sessionReady: session.ready,
        sessionStatus: session.status ?? null,
        hasEvmKey: Boolean(account),
      },
      null,
      2,
    ),
  );

  if (amount <= 0) {
    console.error("No USDC to bridge on this EVM address.");
    process.exit(1);
  }

  const quote = await createDebridgeTx({ amountRaw, evm, sol });
  if (!quote.tx?.to || !quote.tx?.data) {
    console.error("deBridge quote failed:", quote.errorMessage ?? quote);
    process.exit(1);
  }

  const outRaw = quote.estimation?.dstChainTokenOut?.amount ?? "?";
  const outUsd = quote.estimation?.dstChainTokenOut?.approximateUsdValue;
  console.log(
    JSON.stringify(
      {
        orderId: quote.orderId,
        receiveUsdc: outRaw === "?" ? null : Number(outRaw) / 1e6,
        receiveUsdApprox: outUsd ?? null,
        fixFeeEth: quote.fixFee
          ? Number(formatEther(BigInt(quote.fixFee)))
          : null,
        spender: quote.tx.to,
      },
      null,
      2,
    ),
  );

  if (!execute) {
    console.log(
      "\nDry-run only. To bridge into Forecast hot wallet:\n" +
        "  npx tsx scripts/bridge-arb-usdc-to-sol.ts --execute --amount " +
        amount +
        "\n" +
        `  recipient=${sol} (Jupiter Forecast signing wallet)\n`,
    );
    return;
  }

  if (!session.ready && !account) {
    console.error(
      "Cannot execute: Alchemy CLI session not detected and no EVM_AGENT_PRIVATE_KEY.\n" +
        "If Alchemy dashboard shows an active session, re-run after: alchemy wallet status --verify\n" +
        "Or bridge manually: https://app.debridge.finance/ (Arb USDC → Sol USDC → " +
        sol +
        ")",
    );
    process.exit(1);
  }

  if (!session.ready && account) {
    console.log("Session detector soft-fail; continuing with EVM_AGENT_PRIVATE_KEY.");
  }
  if (session.ready && !account) {
    console.log("Using Alchemy CLI session for Arb signing.");
  }

  const valueWei = BigInt(quote.fixFee ?? quote.tx.value ?? "0");
  if (ethBal < valueWei + parseEther("0.0005")) {
    console.error(
      `Need ~${formatEther(valueWei)} ETH fixFee + gas; have ${formatEther(ethBal)}`,
    );
    process.exit(1);
  }

  if (account) {
    const wallet = createWalletClient({
      account,
      chain: arbitrum,
      transport: http(arbRpc()),
    });

    const allowance = await publicClient.readContract({
      address: USDC_ARB,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account.address, quote.tx.to as Address],
    });

    if (allowance < BigInt(amountRaw)) {
      console.log("Approving USDC…");
      const approveHash = await wallet.writeContract({
        address: USDC_ARB,
        abi: erc20Abi,
        functionName: "approve",
        args: [quote.tx.to as Address, BigInt(amountRaw)],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });
      console.log("approve", approveHash);
    }

    // Fresh quote right before send (deBridge recommends <30s)
    const fresh = await createDebridgeTx({ amountRaw, evm: account.address, sol });
    if (!fresh.tx?.to || !fresh.tx?.data) {
      console.error("fresh quote failed", fresh);
      process.exit(1);
    }

    console.log("Sending deBridge order…");
    const hash = await wallet.sendTransaction({
      to: fresh.tx.to as Address,
      data: fresh.tx.data as Hex,
      value: BigInt(fresh.fixFee ?? fresh.tx.value ?? "0"),
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(
      JSON.stringify(
        { ok: receipt.status === "success", hash, orderId: fresh.orderId },
        null,
        2,
      ),
    );
    return;
  }

  // Session path: approve via CLI, then raw call via wallet_sendCalls if supported
  console.log("Approving USDC via Alchemy session…");
  const approve = await runAlchemyCli(
    [
      "evm",
      "approve",
      quote.tx.to,
      "--token-address",
      USDC_ARB,
      "--amount",
      String(amount),
      "--signer",
      "session",
      "-n",
      "arb-mainnet",
      "-y",
    ],
    { timeoutMs: 180_000 },
  );
  if (!approve.ok) {
    console.error("approve failed:", approve.error ?? approve.data);
    process.exit(1);
  }
  console.log("approve ok", approve.data);

  const fresh = await createDebridgeTx({ amountRaw, evm, sol });
  if (!fresh.tx?.to || !fresh.tx?.data) {
    console.error("fresh quote failed", fresh);
    process.exit(1);
  }

  const valueEth = formatEther(BigInt(fresh.fixFee ?? fresh.tx.value ?? "0"));
  console.log("Sending deBridge order via Alchemy session smart wallet…");

  const { sendCallsViaAlchemySession } = await import(
    "../lib/alchemy-session-send"
  );
  const sent = await sendCallsViaAlchemySession({
    to: fresh.tx.to as Address,
    data: fresh.tx.data as Hex,
    valueWei: BigInt(fresh.fixFee ?? fresh.tx.value ?? "0"),
  });

  if (!sent.ok) {
    console.error(
      "Session sendCalls failed. Bridge manually at https://app.debridge.finance/\n",
      sent.error,
    );
    console.log(
      JSON.stringify(
        {
          manual: {
            network: "Arbitrum",
            from: evm,
            toSolana: sol,
            amountUsdc: amount,
            expectReceiveUsdc:
              Number(fresh.estimation?.dstChainTokenOut?.amount ?? 0) / 1e6,
            fixFeeEth: valueEth,
            contract: fresh.tx.to,
            note: "USDC approve may already be set for deBridge spender",
          },
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        callId: sent.callId,
        txHash: sent.txHash,
        orderId: fresh.orderId,
        toSolana: sol,
        amountUsdc: amount,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
