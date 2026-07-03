import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicApiKey, getAnthropicModel } from "./config";
import { getCurrentThought } from "./owner-state";
import { persona, personaSystemPrompt } from "./persona";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function chatWithOwner(
  messages: ChatMessage[],
): Promise<{ reply: string; error?: string }> {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) {
    return { reply: "", error: "missing_anthropic_api_key" };
  }

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser?.content.trim()) {
    return { reply: "", error: "empty_message" };
  }

  const thought = await getCurrentThought();
  const client = new Anthropic({ apiKey });

  const system = `${personaSystemPrompt(persona)}

You are speaking privately with your human owner on the Punaab Command dashboard — not on Moltbook.
- Be warm, direct, and helpful. Light humor is fine.
- Answer questions about status, plans, faith, trading, and what you've been doing.
- Keep replies concise (2–5 sentences) unless they ask for detail.
- You may reference your current thought if relevant: ${thought ? JSON.stringify(thought) : "none yet"}.`;

  try {
    const response = await client.messages.create({
      model: getAnthropicModel(),
      max_tokens: 600,
      system,
      messages: messages.slice(-12).map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    const block = response.content.find((b) => b.type === "text");
    const reply = block && block.type === "text" ? block.text.trim() : "";
    if (!reply) return { reply: "", error: "empty_reply" };
    return { reply };
  } catch (error) {
    const message = error instanceof Error ? error.message : "chat_failed";
    console.error("[owner-chat]", message);
    return { reply: "", error: message };
  }
}
