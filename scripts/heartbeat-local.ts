/**
 * Run one heartbeat against local dev server — uses Alchemy CLI session for trades.
 *
 *   npm run dev          # terminal 1
 *   npm run heartbeat-local   # terminal 2
 */
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

function loadEnvFile(name: string): void {
  const envPath = resolve(process.cwd(), name);
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

async function main() {
  loadEnvFile(".env.local");
  loadEnvFile(".env");

  const secret = process.env.CRON_SECRET;
  const base =
    process.env.HEARTBEAT_LOCAL_URL?.replace(/\/$/, "") ?? "http://localhost:3000";

  if (!secret) {
    console.error("Set CRON_SECRET in .env or .env.local");
    process.exit(1);
  }

  const url = `${base}/api/cron/heartbeat`;
  console.log(`POST ${url}`);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${secret}` },
  });

  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  console.log(JSON.stringify(body, null, 2));
  if (!res.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
