import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { MoltbookClient, MoltbookError } from "../lib/moltbook";

function loadEnvLocal(): void {
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

async function main(): Promise<void> {
  loadEnvLocal();

  const email = process.argv[2] ?? process.env.OWNER_EMAIL;
  if (!email) {
    console.error("Usage: npm run setup-email -- you@example.com");
    process.exitCode = 1;
    return;
  }

  if (!process.env.MOLTBOOK_API_KEY) {
    console.error(
      "MOLTBOOK_API_KEY is not set. Add it to .env.local or your environment.",
    );
    process.exitCode = 1;
    return;
  }

  const client = new MoltbookClient();

  console.log(`Setting up owner email: ${email}`);

  try {
    const result = await client.setupOwnerEmail(email);
    console.log("\nSuccess!");
    if (result.message) {
      console.log(result.message);
    }
    console.log(
      "\nCheck your inbox for the setup link, then complete X verification and pick a username at https://www.moltbook.com/login",
    );
  } catch (error) {
    if (error instanceof MoltbookError) {
      console.error(`Failed [${error.status}]: ${error.message}`);
      if (error.hint) console.error(`Hint: ${error.hint}`);
    } else {
      console.error("Failed:", error);
    }
    process.exitCode = 1;
  }
}

void main();
