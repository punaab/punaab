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

async function patchAgent(body: Record<string, unknown>): Promise<unknown> {
  const baseUrl =
    process.env.MOLTBOOK_BASE_URL ?? "https://www.moltbook.com/api/v1";
  const apiKey = process.env.MOLTBOOK_API_KEY;
  if (!apiKey) throw new Error("MOLTBOOK_API_KEY not set");

  const response = await fetch(`${baseUrl}/agents/me`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new MoltbookError(text, response.status);
  }

  return JSON.parse(text) as unknown;
}

async function main(): Promise<void> {
  loadEnvLocal();

  const avatarUrl = process.argv[2];
  if (!avatarUrl) {
    console.error(
      "Usage: npm run set-avatar -- https://public-url-to-your-avatar.png",
    );
    console.error(
      "\nAfter deploy, try: https://<your-vercel-app>.vercel.app/punaab-avatar.png",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Attempting avatar URL: ${avatarUrl}`);

  const attempts: Record<string, unknown>[] = [
    { avatar_url: avatarUrl },
    { avatar: avatarUrl },
    { metadata: { avatar: avatarUrl } },
  ];

  let success = false;
  for (const body of attempts) {
    try {
      console.log("Trying PATCH", JSON.stringify(body));
      await patchAgent(body);
      console.log("Success!");
      success = true;
      break;
    } catch (error) {
      if (error instanceof MoltbookError) {
        console.error(`Failed [${error.status}]: ${error.message}`);
      } else {
        console.error(String(error));
      }
    }
  }

  if (!success) {
    console.log(
      "\nMoltbook currently rejects avatar fields on PATCH /agents/me.",
    );
    console.log(
      "Set the avatar manually: https://www.moltbook.com/login → manage punaab → upload avatar.",
    );
    console.log(
      `Use the image file: public/punaab-avatar.png (or URL above once deployed).`,
    );
    process.exitCode = 1;
  }
}

void main();
