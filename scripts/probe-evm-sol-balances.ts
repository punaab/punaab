/**
 * Probe EVM (Arb/Base) + Solana balances for bridge planning.
 */
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

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

const key = process.env.ALCHEMY_API_KEY!;
const addrs = [
  process.env.WATCH_BASE_ADDRESS,
  process.env.TRADING_BASE_ADDRESS,
  "0x310648bd5ad77b4a4dd8725d53902d52e475ec73",
]
  .map((a) => a?.trim())
  .filter((a): a is string => Boolean(a && a.startsWith("0x")));
const unique = [...new Set(addrs)];
const sol = (process.env.TRADING_SOLANA_ADDRESS || process.env.WATCH_SOLANA_ADDRESS || "").trim();

const USDC_ARB = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_SOL = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

async function rpc(url: string, method: string, params: unknown[]) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = (await res.json()) as { result?: unknown; error?: unknown };
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j.result;
}

function padBalanceOf(a: string) {
  return "0x70a08231000000000000000000000000" + a.slice(2).toLowerCase();
}

async function probeEvm(addr: string) {
  const arbRpc = `https://arb-mainnet.g.alchemy.com/v2/${key}`;
  const baseRpc = "https://mainnet.base.org";
  const [arbEthHex, baseEthHex, arbUsdcHex, baseUsdcHex] = await Promise.all([
    rpc(arbRpc, "eth_getBalance", [addr, "latest"]) as Promise<string>,
    rpc(baseRpc, "eth_getBalance", [addr, "latest"]).catch(() => "0x0") as Promise<string>,
    rpc(arbRpc, "eth_call", [{ to: USDC_ARB, data: padBalanceOf(addr) }, "latest"]) as Promise<string>,
    rpc(baseRpc, "eth_call", [{ to: USDC_BASE, data: padBalanceOf(addr) }, "latest"]).catch(() => "0x0") as Promise<string>,
  ]);
  return {
    addr,
    arbEth: Number(BigInt(arbEthHex || "0")) / 1e18,
    baseEth: Number(BigInt(baseEthHex || "0")) / 1e18,
    arbUsdc: Number(BigInt(arbUsdcHex || "0")) / 1e6,
    baseUsdc: Number(BigInt(baseUsdcHex || "0")) / 1e6,
  };
}

async function main() {
  console.log({
    unique,
    sol,
    hasEvmKey: Boolean(process.env.EVM_AGENT_PRIVATE_KEY),
    hasSolKey: Boolean(process.env.SOLANA_AGENT_PRIVATE_KEY),
  });

  for (const a of unique) {
    console.log(JSON.stringify(await probeEvm(a), null, 2));
  }

  const solRpc = process.env.ALCHEMY_SOLANA_RPC_URL || `https://solana-mainnet.g.alchemy.com/v2/${key}`;
  const solLamports = (await rpc(solRpc, "getBalance", [sol])) as { value?: number } | number;
  const solBal =
    typeof solLamports === "number"
      ? solLamports / 1e9
      : Number(solLamports?.value ?? 0) / 1e9;

  const tokenRes = await fetch(solRpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTokenAccountsByOwner",
      params: [sol, { mint: USDC_SOL }, { encoding: "jsonParsed" }],
    }),
  });
  const tokenJson = (await tokenRes.json()) as {
    result?: {
      value?: Array<{
        account: { data: { parsed: { info: { tokenAmount: { uiAmount: number } } } } };
      }>;
    };
  };
  const solUsdc = (tokenJson.result?.value ?? []).reduce(
    (s, a) => s + (a.account.data.parsed.info.tokenAmount.uiAmount || 0),
    0,
  );
  console.log(JSON.stringify({ sol, solBal, solUsdc }, null, 2));

  for (const address of unique) {
    const r = await fetch(
      `https://api.g.alchemy.com/data/v1/${key}/assets/tokens/by-address`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          addresses: [
            { address, networks: ["arb-mainnet", "base-mainnet", "eth-mainnet"] },
          ],
        }),
      },
    );
    console.log("portfolio", address, r.status);
    if (!r.ok) {
      console.log(await r.text());
      continue;
    }
    const j = (await r.json()) as {
      data?: {
        tokens?: Array<{
          symbol?: string;
          network?: string;
          tokenBalance?: string;
          tokenMetadata?: { decimals?: number; symbol?: string };
          tokenPrices?: Array<{ value?: string }>;
        }>;
      };
    };
    const rows: Array<{ net?: string; sym?: string; bal: number; usd: number }> = [];
    for (const t of j.data?.tokens ?? []) {
      const dec = t.tokenMetadata?.decimals ?? 18;
      let bal = 0;
      try {
        bal = Number(BigInt(t.tokenBalance || "0")) / 10 ** dec;
      } catch {
        bal = 0;
      }
      const price = Number(t.tokenPrices?.[0]?.value ?? 0);
      const sym = (t.tokenMetadata?.symbol || t.symbol || "").toUpperCase();
      const usd =
        bal *
        (price || (["USDC", "USDT", "DAI"].includes(sym) ? 1 : 0));
      if (usd >= 1) rows.push({ net: t.network, sym, bal, usd: Math.round(usd * 100) / 100 });
    }
    rows.sort((a, b) => b.usd - a.usd);
    console.log(JSON.stringify(rows.slice(0, 20), null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});