import { isTelegramOwner } from "@/lib/config";
import { handleTelegramMessage } from "@/lib/telegram-bot";
import {
  sendTelegramMessage,
  verifyWebhookSecret,
  type TelegramUpdate,
} from "@/lib/telegram";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function processUpdate(update: TelegramUpdate): Promise<void> {
  const msg = update.message;
  if (!msg?.text || !msg.chat) return;

  const chatId = msg.chat.id;

  if (!isTelegramOwner(chatId)) {
    await sendTelegramMessage(
      chatId,
      `Unauthorized. Your chat ID is <code>${chatId}</code> — add it as TELEGRAM_OWNER_CHAT_ID in Vercel, then redeploy.`,
      { parseMode: "HTML" },
    );
    return;
  }

  await handleTelegramMessage(msg);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ secret?: string[] }> },
) {
  const params = await context.params;
  const pathSecret = params.secret?.[0];
  const headerSecret = request.headers.get("x-telegram-bot-api-secret-token");

  if (!verifyWebhookSecret(pathSecret, headerSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    await processUpdate(update);
  } catch (error) {
    console.error("[telegram] webhook error:", error);
  }

  return NextResponse.json({ ok: true });
}
