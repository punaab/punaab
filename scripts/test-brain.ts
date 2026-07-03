import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { decide, defaultBrainContext } from "../lib/brain";

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

async function main() {
  loadEnvLocal();
  try {
    const plan = await decide(
      defaultBrainContext({
        feed: [],
        notifications: [],
        canPost: true,
        maxUpvotes: 5,
      }),
    );
    console.log("plan:", JSON.stringify(plan, null, 2));
  } catch (error) {
    console.error("brain threw:", error);
  }
}

main();
