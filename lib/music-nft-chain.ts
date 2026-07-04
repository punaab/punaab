import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  isAddress,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import {
  getAlchemyApiKey,
  getEvmAgentPrivateKey,
  getMusicNftContractAddress,
  getTradingBaseAddress,
} from "./config";
import { PUNAAB_MUSIC_NFT_ABI } from "./music-nft-abi";

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const USDC_DECIMALS = 6;

const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

function getPublicClient() {
  const apiKey = getAlchemyApiKey();
  const url = apiKey
    ? `https://base-mainnet.g.alchemy.com/v2/${apiKey}`
    : "https://mainnet.base.org";
  return createPublicClient({ chain: base, transport: http(url) });
}

function getMintWalletClient() {
  const key = getEvmAgentPrivateKey();
  if (!key) return null;
  const normalized = key.startsWith("0x") ? key : `0x${key}`;
  try {
    const account = privateKeyToAccount(normalized as Hex);
    const apiKey = getAlchemyApiKey();
    const url = apiKey
      ? `https://base-mainnet.g.alchemy.com/v2/${apiKey}`
      : "https://mainnet.base.org";
    return createWalletClient({
      account,
      chain: base,
      transport: http(url),
    });
  } catch {
    return null;
  }
}

export function hasMusicNftMinter(): boolean {
  return getMintWalletClient() !== null && !!getMusicNftContractAddress();
}

export interface PaymentVerificationResult {
  ok: boolean;
  error?: string;
  from?: string;
  to?: string;
  amountUsdc?: number;
}

/** Verify a Base USDC transfer tx pays Punaab the expected amount. */
export async function verifyUsdcPayment(
  txHash: string,
  expectedAmountUsdc: number,
): Promise<PaymentVerificationResult> {
  const payTo = getTradingBaseAddress();
  if (!payTo || !isAddress(payTo)) {
    return { ok: false, error: "seller_wallet_not_configured" };
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return { ok: false, error: "invalid_tx_hash" };
  }

  const client = getPublicClient();
  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash as Hex });
  } catch {
    return { ok: false, error: "tx_not_found" };
  }

  if (receipt.status !== "success") {
    return { ok: false, error: "tx_failed" };
  }

  const expectedWei = BigInt(Math.round(expectedAmountUsdc * 10 ** USDC_DECIMALS));
  const payToLower = payTo.toLowerCase();

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== USDC_BASE.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: [transferEvent],
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName !== "Transfer") continue;
      const { from, to, value } = decoded.args as {
        from: Address;
        to: Address;
        value: bigint;
      };
      if (to.toLowerCase() !== payToLower) continue;
      if (value < expectedWei) {
        return {
          ok: false,
          error: "insufficient_amount",
          from,
          to,
          amountUsdc: Number(value) / 10 ** USDC_DECIMALS,
        };
      }
      return {
        ok: true,
        from,
        to,
        amountUsdc: Number(value) / 10 ** USDC_DECIMALS,
      };
    } catch {
      continue;
    }
  }

  return { ok: false, error: "usdc_transfer_not_found" };
}

export interface MintMusicNftResult {
  ok: boolean;
  tokenId?: number;
  txHash?: string;
  error?: string;
}

/** Mint a music NFT to buyer with metadata URI. */
export async function mintMusicNft(
  toAddress: string,
  tokenUri: string,
): Promise<MintMusicNftResult> {
  const contract = getMusicNftContractAddress();
  if (!contract || !isAddress(contract)) {
    return { ok: false, error: "contract_not_configured" };
  }
  if (!isAddress(toAddress)) {
    return { ok: false, error: "invalid_recipient" };
  }

  const wallet = getMintWalletClient();
  if (!wallet) {
    return { ok: false, error: "minter_not_configured" };
  }

  const [account] = await wallet.getAddresses();
  const publicClient = getPublicClient();

  try {
    const hash = await wallet.writeContract({
      address: contract as Address,
      abi: PUNAAB_MUSIC_NFT_ABI,
      functionName: "mintTo",
      args: [toAddress as Address, tokenUri],
      account,
      chain: base,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      return { ok: false, error: "mint_tx_failed", txHash: hash };
    }

    let tokenId: number | undefined;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== contract.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi: PUNAAB_MUSIC_NFT_ABI,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "Transfer") {
          const args = decoded.args as { tokenId?: bigint };
          if (args.tokenId != null) {
            tokenId = Number(args.tokenId);
            break;
          }
        }
      } catch {
        continue;
      }
    }

    if (!tokenId) {
      const total = await publicClient.readContract({
        address: contract as Address,
        abi: PUNAAB_MUSIC_NFT_ABI,
        functionName: "totalMinted",
      });
      tokenId = Number(total);
    }

    return { ok: true, tokenId, txHash: hash };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "mint_failed",
    };
  }
}

export { USDC_BASE };
