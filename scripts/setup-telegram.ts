/**
 * Register Telegram webhook with Telegram API.
 *
 * 1. Message @BotFather on Telegram → /newbot → save TELEGRAM_BOT_TOKEN
 * 2. Add TELEGRAM_BOT_TOKEN (+ optional TELEGRAM_WEBHOOK_SECRET) to .env.local
 * 3. npm run setup-telegram
 * 4. Message your bot /start → copy chat ID → TELEGRAM_OWNER_CHAT_ID
 * 5. Add env vars to Vercel and redeploy
 */
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import {
  deleteTelegramWebhook,
  getWebhookUrl,
  setTelegramWebhook,
} from "../lib/telegram";

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

  const action = process.argv[2] ?? "set";

  if (action === "delete") {
    await deleteTelegramWebhook();
    console.log("Webhook deleted.");
    return;
  }

  const url = getWebhookUrl();
  await setTelegramWebhook(url);
  console.log("Telegram webhook registered:");
  console.log(`  ${url}`);
  console.log("\nNext steps:");
  console.log("  1. Message your bot /start on Telegram");
  console.log("  2. Copy your chat ID into TELEGRAM_OWNER_CHAT_ID");
  console.log("  3. Add TELEGRAM_BOT_TOKEN + TELEGRAM_OWNER_CHAT_ID to Vercel");
  console.log("  4. Redeploy production");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
