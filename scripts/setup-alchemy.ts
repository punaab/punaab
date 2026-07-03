/**
 * Alchemy Agent Wallet setup for Punaab.
 *
 * 1. npm i -g @alchemy/cli@latest
 * 2. npm run setup-alchemy
 * 3. Complete browser login + wallet session approval
 * 4. Copy Solana address → TRADING_SOLANA_ADDRESS / WATCH_SOLANA_ADDRESS
 * 5. For Vercel auto-trading: set SOLANA_AGENT_PRIVATE_KEY (see README)
 */
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { execSync } from "child_process";

function loadEnvLocal(): void {
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function run(cmd: string): void {
  console.log(`\n> ${cmd}\n`);
  execSync(cmd, { stdio: "inherit", env: process.env });
}

async function main() {
  loadEnvLocal();

  const apiKey = process.env.ALCHEMY_API_KEY;
  if (!apiKey) {
    console.error("Set ALCHEMY_API_KEY in .env.local first.");
    process.exit(1);
  }

  console.log("=== Punaab Alchemy Setup ===\n");

  run(`alchemy config set api-key ${apiKey}`);

  console.log("\nStep 1: Log in to Alchemy (browser will open)...");
  try {
    run("alchemy auth login -y");
  } catch {
    console.log("If login failed, run manually: alchemy auth login");
  }

  console.log("\nStep 2: Connect Agent Wallet session...");
  console.log("Approve the session in the Alchemy Dashboard for wallet:");
  console.log("  6VoBMcEgfdWSCBYBJ46QkzyHiZ2S4WU6YWRdej5zUbhZ (or your agent wallet)\n");

  try {
    run("alchemy wallet connect --mode session --instance-name punaab");
  } catch {
    console.log("If connect failed, run manually:");
    console.log("  alchemy wallet connect --mode session --instance-name punaab");
  }

  console.log("\nStep 3: Verify session...");
  try {
    run("alchemy --json --no-interactive wallet status --verify");
    run("alchemy --json --no-interactive wallet address");
  } catch {
    console.log("Run: alchemy wallet status --verify");
  }

  console.log("\n=== Next: add to .env.local and Vercel ===");
  console.log("TRADING_ENABLED=true");
  console.log("TRADING_SOLANA_ADDRESS=6VoBMcEgfdWSCBYBJ46QkzyHiZ2S4WU6YWRdej5zUbhZ");
  console.log("WATCH_SOLANA_ADDRESS=6VoBMcEgfdWSCBYBJ46QkzyHiZ2S4WU6YWRdej5zUbhZ");
  console.log("ALCHEMY_SOLANA_RPC_URL=https://solana-mainnet.g.alchemy.com/v2/YOUR_KEY");
  console.log("\nFor Vercel auto-swaps (Jupiter), also set SOLANA_AGENT_PRIVATE_KEY.");
  console.log("Agent wallets keep keys in Alchemy — use a dedicated hot wallet key for server signing,");
  console.log("or run trades locally via CLI session.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
