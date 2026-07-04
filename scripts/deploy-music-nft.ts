/**
 * Deploy PunaabMusicNFT to Base mainnet.
 * Requires EVM_AGENT_PRIVATE_KEY and ALCHEMY_API_KEY in .env
 *
 * Usage: npx tsx scripts/deploy-music-nft.ts
 */
import * as fs from "fs";
import * as path from "path";
import solc from "solc";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { PUNAAB_MUSIC_NFT_ABI } from "../lib/music-nft-abi";

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile(path.join(process.cwd(), ".env"));
loadEnvFile(path.join(process.cwd(), ".env.local"));

function compileContract(): { bytecode: Hex; abi: typeof PUNAAB_MUSIC_NFT_ABI } {
  const contractPath = path.join(process.cwd(), "contracts", "PunaabMusicNFT.sol");
  const source = fs.readFileSync(contractPath, "utf8");

  const input = {
    language: "Solidity",
    sources: { "PunaabMusicNFT.sol": { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        "*": { "*": ["abi", "evm.bytecode.object"] },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input))) as {
    errors?: Array<{ severity: string; formattedMessage: string }>;
    contracts?: Record<
      string,
      Record<string, { abi: unknown; evm: { bytecode: { object: string } } }>
    >;
  };

  if (output.errors?.some((e) => e.severity === "error")) {
    const msgs = output.errors
      .filter((e) => e.severity === "error")
      .map((e) => e.formattedMessage)
      .join("\n");
    throw new Error(`Solidity compile failed:\n${msgs}`);
  }

  const compiled = output.contracts?.["PunaabMusicNFT.sol"]?.PunaabMusicNFT;
  if (!compiled?.evm?.bytecode?.object) {
    throw new Error("Compile output missing bytecode");
  }

  return {
    bytecode: `0x${compiled.evm.bytecode.object}` as Hex,
    abi: compiled.abi as typeof PUNAAB_MUSIC_NFT_ABI,
  };
}

async function main() {
  const key = process.env.EVM_AGENT_PRIVATE_KEY?.trim();
  if (!key) {
    console.error("Set EVM_AGENT_PRIVATE_KEY in .env");
    process.exit(1);
  }

  const apiKey = process.env.ALCHEMY_API_KEY?.trim();
  const rpc = apiKey
    ? `https://base-mainnet.g.alchemy.com/v2/${apiKey}`
    : "https://mainnet.base.org";

  const normalized = key.startsWith("0x") ? key : `0x${key}`;
  const account = privateKeyToAccount(normalized as Hex);

  const publicClient = createPublicClient({ chain: base, transport: http(rpc) });
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(rpc),
  });

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Deployer: ${account.address}`);
  console.log(`Balance: ${Number(balance) / 1e18} ETH on Base`);

  const { bytecode, abi } = compileContract();
  console.log("Compiled PunaabMusicNFT.sol");

  const hash = await walletClient.deployContract({
    abi,
    bytecode,
    args: ["Punaab Agent Anthems", "PANTHEM"],
    account,
    chain: base,
  });

  console.log(`Deploy tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const address = receipt.contractAddress;

  if (!address) {
    console.error("Deploy failed — no contract address in receipt");
    process.exit(1);
  }

  console.log("\n✅ PunaabMusicNFT deployed on Base:");
  console.log(`   MUSIC_NFT_CONTRACT_ADDRESS=${address}`);
  console.log("\nAdd this to .env and Vercel, then redeploy.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
