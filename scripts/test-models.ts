import { existsSync, readFileSync } from "fs";
import Anthropic from "@anthropic-ai/sdk";

function loadEnvLocal(): void {
  const envPath = ".env.local";
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
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const models = [
    "claude-sonnet-4-6",
    "claude-sonnet-4-20250514",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
  ];
  for (const model of models) {
    try {
      await client.messages.create({
        model,
        max_tokens: 10,
        messages: [{ role: "user", content: "hi" }],
      });
      console.log(model, "OK");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(model, msg.slice(0, 100));
    }
  }
}

main();
