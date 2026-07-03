import { createHmac, timingSafeEqual } from "crypto";
import { getSiteUrl, getTelegramBotToken, getTelegramWebhookSecret } from "./config";

const API_BASE = "https://api.telegram.org";

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; username?: string; first_name?: string };
  text?: string;
}

async function apiCall<T>(
  method: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const token = getTelegramBotToken();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");

  const res = await fetch(`${API_BASE}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!data.ok) {
    throw new Error(data.description ?? `Telegram API ${method} failed`);
  }
  return data.result as T;
}

export async function sendTelegramMessage(
  chatId: number | string,
  text: string,
  options?: { parseMode?: "HTML" | "Markdown" },
): Promise<void> {
  const chunks = splitMessage(text, 4000);
  for (const chunk of chunks) {
    await apiCall("sendMessage", {
      chat_id: chatId,
      text: chunk,
      parse_mode: options?.parseMode,
      disable_web_page_preview: true,
    });
  }
}

function splitMessage(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = max;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

export async function setTelegramWebhook(url: string): Promise<void> {
  const secret = getTelegramWebhookSecret();
  await apiCall("setWebhook", {
    url,
    secret_token: secret || undefined,
    allowed_updates: ["message"],
    drop_pending_updates: true,
  });
}

export async function deleteTelegramWebhook(): Promise<void> {
  await apiCall("deleteWebhook", { drop_pending_updates: true });
}

export function getWebhookUrl(): string {
  const base = getSiteUrl();
  const secret = getTelegramWebhookSecret();
  if (secret) {
    return `${base}/api/telegram/webhook/${secret}`;
  }
  return `${base}/api/telegram/webhook`;
}

export function verifyWebhookSecret(
  pathSecret: string | undefined,
  headerSecret: string | null,
): boolean {
  const expected = getTelegramWebhookSecret();
  if (!expected) return true;

  const candidate = headerSecret ?? pathSecret;
  if (!candidate) return false;

  try {
    const a = Buffer.from(candidate);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Constant-time compare for optional webhook hardening */
export function safeEqual(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** HMAC for internal use if needed */
export function hmacSign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}
