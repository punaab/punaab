/**
 * Local daemon for Jupiter Prediction Up/Down markets.
 * Usage: npm run prediction-trader
 *        npm run prediction-trader -- --once
 */
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

function loadEnvFile(name: string, override = false): void {
  const envPath = resolve(process.cwd(), name);
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (
      override ||
      !process.env[key] ||
      process.env[key]?.trim() === ""
    ) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(".env.local", true);
loadEnvFile(".env", true);

const once = process.argv.includes("--once");

async function tick() {
  const { runPredictionTick } = await import(
    "../lib/prediction-trading/engine"
  );
  const summary = await runPredictionTick();
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

async function main() {
  const { PREDICTION_TRADING_LIMITS, isDryRun } = await import("../lib/config");
  console.log(
    `[prediction-trader] starting poll=${PREDICTION_TRADING_LIMITS.pollIntervalMs}ms once=${once} dryRun=${isDryRun()}`,
  );

  if (once) {
    const summary = await tick();
    process.exit(summary.ok ? 0 : 1);
    return;
  }

  for (;;) {
    try {
      await tick();
    } catch (error) {
      console.error("[prediction-trader] tick error:", error);
    }
    const { PREDICTION_TRADING_LIMITS: limits } = await import("../lib/config");
    await new Promise((r) => setTimeout(r, limits.pollIntervalMs));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
