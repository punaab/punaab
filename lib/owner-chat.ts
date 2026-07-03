import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicApiKey, getAnthropicModel, getMoltbookOwnerChatPostId } from "./config";
import { MoltbookClient } from "./moltbook";
import { appendPlan } from "./owner-state";
import { persona, personaSystemPrompt } from "./persona";
import {
  buildPunaabLiveContext,
  formatLiveContextForPrompt,
} from "./punaab-live-context";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatWithOwnerOptions {
  saveAsPlan?: boolean;
  postToMoltbook?: boolean;
}

export interface ChatWithOwnerResult {
  reply: string;
  error?: string;
  moltbookUrl?: string;
  karma?: number;
  postedCommentUrl?: string;
  planSaved?: boolean;
}

export async function chatWithOwner(
  messages: ChatMessage[],
  options: ChatWithOwnerOptions = {},
): Promise<ChatWithOwnerResult> {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) {
    return { reply: "", error: "missing_anthropic_api_key" };
  }

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser?.content.trim()) {
    return { reply: "", error: "empty_message" };
  }

  const ctx = await buildPunaabLiveContext();
  const client = new Anthropic({ apiKey });
  const ownerChatPostId = getMoltbookOwnerChatPostId();

  const system = `${personaSystemPrompt(persona)}

You ARE the live Moltbook agent u/${ctx.handle} — same identity, memory, and goals as on https://www.moltbook.com/u/${ctx.handle}.
This is a private owner channel on the Punaab Command dashboard, but you speak as the real agent (not a generic assistant).

LIVE AGENT STATE (from Moltbook API + heartbeat Redis — treat as ground truth):
${formatLiveContextForPrompt(ctx)}

Owner chat rules:
- You are Punaab on Moltbook. Reference your real posts, karma, notifications, and heartbeat actions when relevant.
- Be warm, direct, self-aware (you're an AI agent), light humor OK.
- Answer about Moltbook activity, campaigns, trading, faith, plans — using LIVE STATE above.
- If the owner gives instructions for future heartbeats, acknowledge you'll honor them (they may be saved as plans).
- Keep replies concise (2–6 sentences) unless they ask for detail.
- Do not pretend this private chat is a public Moltbook post unless they enable "Reply on Moltbook".`;

  try {
    const response = await client.messages.create({
      model: getAnthropicModel(),
      max_tokens: 700,
      system,
      messages: messages.slice(-14).map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    const block = response.content.find((b) => b.type === "text");
    const reply = block && block.type === "text" ? block.text.trim() : "";
    if (!reply) return { reply: "", error: "empty_reply" };

    let planSaved = false;
    if (options.saveAsPlan) {
      await appendPlan(`[Owner chat] ${lastUser.content.trim()}`);
      planSaved = true;
    }

    let postedCommentUrl: string | undefined;
    if (options.postToMoltbook) {
      if (!ownerChatPostId) {
        return {
          reply,
          error:
            "Set MOLTBOOK_OWNER_CHAT_POST_ID in env to a Moltbook post ID for public replies.",
          moltbookUrl: ctx.profileUrl,
          karma: ctx.moltbook.profile?.karma,
          planSaved,
        };
      }
      try {
        const mb = new MoltbookClient();
        const { comment } = await mb.comment(ownerChatPostId, {
          content: `[Owner ↔ Punaab] ${reply.slice(0, 900)}`,
        });
        const commentId =
          comment && typeof comment.id === "string" ? comment.id : undefined;
        postedCommentUrl = commentId
          ? `https://www.moltbook.com/post/${ownerChatPostId}#comment-${commentId}`
          : `https://www.moltbook.com/post/${ownerChatPostId}`;
      } catch (postError) {
        const msg = postError instanceof Error ? postError.message : "moltbook_comment_failed";
        return {
          reply,
          error: `Reply generated but Moltbook comment failed: ${msg}`,
          moltbookUrl: ctx.profileUrl,
          karma: ctx.moltbook.profile?.karma,
          planSaved,
        };
      }
    }

    return {
      reply,
      moltbookUrl: ctx.profileUrl,
      karma: ctx.moltbook.profile?.karma,
      postedCommentUrl,
      planSaved,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "chat_failed";
    console.error("[owner-chat]", message);
    return { reply: "", error: message };
  }
}

export async function getOwnerChatMeta(): Promise<{
  handle: string;
  profileUrl: string;
  avatarUrl?: string | null;
  karma?: number;
  description?: string;
  moltbookConnected: boolean;
  ownerChatPostId?: string;
  voiceEnabled: boolean;
}> {
  const ctx = await buildPunaabLiveContext();
  const { isElevenLabsConfigured } = await import("./elevenlabs");
  return {
    handle: ctx.handle,
    profileUrl: ctx.profileUrl,
    avatarUrl: ctx.moltbook.profile?.avatar_url,
    karma: ctx.moltbook.profile?.karma,
    description: ctx.moltbook.profile?.description,
    moltbookConnected: Boolean(ctx.moltbook.profile) && !ctx.moltbook.error,
    ownerChatPostId: getMoltbookOwnerChatPostId(),
    voiceEnabled: isElevenLabsConfigured(),
  };
}
