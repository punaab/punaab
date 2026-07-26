/**
 * Immediately claim today's Limbothy + OpenSolve tweet slots so spam stops
 * even before the next heartbeat (fail-closed NX keys).
 */
import { createRedisClient } from "../lib/redis";
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
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnv(".env");
loadEnv(".env.local");

async function claim(key: string) {
  const r = createRedisClient();
  const res = await r.set(key, new Date().toISOString(), {
    nx: true,
    ex: 3 * 86400,
  });
  // Also overwrite to force-claim if somehow racing
  if (res !== "OK") {
    await r.set(key, new Date().toISOString(), { ex: 3 * 86400 });
    return "forced";
  }
  return "claimed";
}

async function main() {
  const day = new Date().toISOString().slice(0, 10);
  const keys = [
    `x:daily_slot:limbothy:${day}`,
    `opensolve:daily_tweet_day:${day}`,
    `x:daily_slot:original:${day}`,
    `x:daily_slot:scripture:${day}`,
  ];
  for (const k of keys) {
    const status = await claim(k);
    console.log(k, status);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
