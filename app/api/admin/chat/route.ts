import { isAdminAuthenticatedFromCookies } from "@/lib/admin-auth";
import { isElevenLabsConfigured, synthesizeSpeech } from "@/lib/elevenlabs";
import {
  chatWithOwner,
  getOwnerChatMeta,
  type ChatMessage,
} from "@/lib/owner-chat";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdminAuthenticatedFromCookies())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const meta = await getOwnerChatMeta();
  return NextResponse.json(meta);
}

export async function POST(request: NextRequest) {
  if (!(await isAdminAuthenticatedFromCookies())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: {
    messages?: ChatMessage[];
    speak?: boolean;
    saveAsPlan?: boolean;
    postToMoltbook?: boolean;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const result = await chatWithOwner(messages, {
    saveAsPlan: Boolean(body.saveAsPlan),
    postToMoltbook: Boolean(body.postToMoltbook),
  });

  if (result.error && !result.reply) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "missing_anthropic_api_key" ? 503 : 400 },
    );
  }

  const wantSpeech = body.speak !== false && isElevenLabsConfigured();
  let audioBase64: string | undefined;
  let audioMime: string | undefined;

  if (wantSpeech && result.reply) {
    const speech = await synthesizeSpeech(result.reply);
    if (speech) {
      audioBase64 = speech.audio.toString("base64");
      audioMime = speech.mimeType;
    }
  }

  return NextResponse.json({
    reply: result.reply,
    error: result.error,
    moltbookUrl: result.moltbookUrl,
    karma: result.karma,
    postedCommentUrl: result.postedCommentUrl,
    planSaved: result.planSaved,
    voiceEnabled: isElevenLabsConfigured(),
    audio: audioBase64
      ? { base64: audioBase64, mimeType: audioMime ?? "audio/mpeg" }
      : undefined,
  });
}
