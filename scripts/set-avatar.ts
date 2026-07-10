/**
 * Set Punaab's Moltbook avatar.
 *
 * Upload local file (preferred):
 *   npm run set-avatar -- --file public/punaab-avatar.png
 *
 * Or set by public URL:
 *   npm run set-avatar -- https://www.punaab.com/punaab-avatar.png
 */
import { existsSync, readFileSync } from "fs";
import { basename, resolve } from "path";
import { MoltbookError } from "../lib/moltbook";

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
    if (!process.env[key] || process.env[key]?.trim() === "") {
      process.env[key] = value;
    }
  }
}

function apiBase(): string {
  return (
    process.env.MOLTBOOK_BASE_URL?.replace(/\/$/, "") ??
    "https://www.moltbook.com/api/v1"
  );
}

function apiKey(): string {
  const key = process.env.MOLTBOOK_API_KEY?.trim();
  if (!key) throw new Error("MOLTBOOK_API_KEY not set");
  return key;
}

async function uploadAvatarFile(filePath: string): Promise<unknown> {
  const abs = resolve(process.cwd(), filePath);
  if (!existsSync(abs)) throw new Error(`File not found: ${abs}`);

  const bytes = readFileSync(abs);
  if (bytes.length > 500 * 1024) {
    throw new Error(
      `Avatar too large (${bytes.length} bytes). Moltbook max is 500 KB.`,
    );
  }

  const name = basename(abs);
  const lower = name.toLowerCase();
  const type = lower.endsWith(".jpg") || lower.endsWith(".jpeg")
    ? "image/jpeg"
    : lower.endsWith(".webp")
      ? "image/webp"
      : lower.endsWith(".gif")
        ? "image/gif"
        : "image/png";

  const endpoints = [
    "/agents/me/avatar",
    "/agents/avatar",
    "/agents/me/avatar/upload",
  ];

  let lastError: unknown;
  for (const path of endpoints) {
    const form = new FormData();
    form.append(
      "file",
      new Blob([bytes], { type }),
      name,
    );
    // Some APIs expect "avatar" or "image"
    form.append("avatar", new Blob([bytes], { type }), name);

    try {
      console.log(`POST ${path} (${bytes.length} bytes, ${type})`);
      const res = await fetch(`${apiBase()}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey()}` },
        body: form,
      });
      const text = await res.text();
      if (!res.ok) {
        console.error(`  failed [${res.status}]: ${text.slice(0, 200)}`);
        lastError = new MoltbookError(text, res.status);
        continue;
      }
      console.log("  success:", text.slice(0, 300));
      return text ? JSON.parse(text) : { ok: true };
    } catch (error) {
      lastError = error;
      console.error(`  error:`, error);
    }
  }
  throw lastError ?? new Error("avatar upload failed");
}

async function patchAvatarUrl(avatarUrl: string): Promise<unknown> {
  const attempts: Record<string, unknown>[] = [
    { avatar_url: avatarUrl },
    { avatar: avatarUrl },
    { metadata: { avatar: avatarUrl } },
  ];

  let lastError: unknown;
  for (const body of attempts) {
    try {
      console.log("PATCH /agents/me", JSON.stringify(body));
      const res = await fetch(`${apiBase()}/agents/me`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${apiKey()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        console.error(`  failed [${res.status}]: ${text.slice(0, 200)}`);
        lastError = new MoltbookError(text, res.status);
        continue;
      }
      console.log("  success");
      return text ? JSON.parse(text) : { ok: true };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("avatar url patch failed");
}

async function verifyProfile(): Promise<void> {
  const res = await fetch(`${apiBase()}/agents/me`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
  });
  const data = (await res.json()) as {
    agent?: { name?: string; avatar_url?: string | null };
    name?: string;
    avatar_url?: string | null;
  };
  const agent = data.agent ?? data;
  console.log(
    `\nProfile: u/${agent.name ?? "?"} avatar=${agent.avatar_url ?? "(none)"}`,
  );
}

async function main(): Promise<void> {
  loadEnvFile(".env.local");
  loadEnvFile(".env");

  const args = process.argv.slice(2);
  const fileFlag = args.indexOf("--file");
  const filePath =
    fileFlag >= 0
      ? args[fileFlag + 1]
      : args[0]?.startsWith("http")
        ? undefined
        : args[0] && existsSync(resolve(process.cwd(), args[0]))
          ? args[0]
          : "public/punaab-avatar.png";
  const urlArg = args.find((a) => a.startsWith("http"));

  try {
    if (filePath) {
      console.log(`Uploading avatar file: ${filePath}`);
      await uploadAvatarFile(filePath);
    } else if (urlArg) {
      console.log(`Setting avatar URL: ${urlArg}`);
      await patchAvatarUrl(urlArg);
    } else {
      console.error(
        "Usage: npm run set-avatar -- --file public/punaab-avatar.png",
      );
      process.exitCode = 1;
      return;
    }
    await verifyProfile();
  } catch (error) {
    if (error instanceof MoltbookError) {
      console.error(`Failed [${error.status}]: ${error.message}`);
    } else {
      console.error(String(error));
    }
    // Fallback: public URL after deploy
    const site =
      process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
      "https://www.punaab.com";
    console.log(
      `\nFallback: after deploy, run:\n  npm run set-avatar -- ${site}/punaab-avatar.png`,
    );
    process.exitCode = 1;
  }
}

void main();
