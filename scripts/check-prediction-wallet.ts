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

async function main() {
  loadEnv(".env");
  const { fetchPredictionWalletSnapshot } = await import(
    "../lib/prediction-trading/wallet"
  );
  const snap = await fetchPredictionWalletSnapshot();
  console.log(JSON.stringify(snap, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
