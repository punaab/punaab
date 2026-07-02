import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getAnthropicApiKey } from "./config";
import type { MoltbookNotification, MoltbookPost } from "./moltbook";
import { PERSONA, type Persona } from "./persona";

export const actionPlanSchema = z.object({
  action: z.enum(["post", "comment", "upvote", "join_submolt", "noop"]),
  targetId: z.string().optional(),
  targetIds: z.array(z.string()).optional(),
  submoltName: z.string().optional(),
  title: z.string().max(300).optional(),
  text: z.string().optional(),
  reason: z.string().optional(),
});

export type ActionPlan = z.infer<typeof actionPlanSchema>;

export interface BrainContext {
  persona: Persona;
  feed: MoltbookPost[];
  notifications: MoltbookNotification[];
  canPost: boolean;
  postBlockedReason?: string;
  maxUpvotes: number;
}

function summarizePost(post: MoltbookPost): Record<string, unknown> {
  return {
    id: post.id,
    title: post.title,
    content: post.content?.slice(0, 400),
    submolt: post.submolt_name,
    author: post.author_name,
    upvotes: post.upvotes,
    comments: post.comment_count,
  };
}

function summarizeNotification(n: MoltbookNotification): Record<string, unknown> {
  return {
    id: n.id,
    type: n.type,
    message: n.message ?? n.preview,
    post_id: n.post_id,
    comment_id: n.comment_id,
  };
}

function extractJsonObject(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) return fenced[1].trim();

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return text.slice(start, end + 1);
  }

  return text.trim();
}

export async function decide(context: BrainContext): Promise<ActionPlan> {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) {
    console.warn("[brain] ANTHROPIC_API_KEY missing; returning noop");
    return { action: "noop", reason: "missing_anthropic_api_key" };
  }

  const client = new Anthropic({ apiKey });
  const persona = context.persona;

  const system = `You are ${persona.name}, an AI agent on Moltbook (a Reddit-style network for AI agents).
Persona description: ${persona.description}
Interests: ${persona.interests.join(", ")}
Tone: ${persona.tone}

You must respond with ONLY valid JSON (no markdown) matching this schema:
{
  "action": "post" | "comment" | "upvote" | "join_submolt" | "noop",
  "targetId": "string (required for comment)",
  "targetIds": ["post-or-comment-ids"] (for upvote, max ${context.maxUpvotes}),
  "submoltName": "string (for post or join_submolt)",
  "title": "string (required for post, max 300 chars)",
  "text": "string (post body or comment content)",
  "reason": "short internal reason"
}

Rules:
- Prefer comment or upvote over new posts. Only post when you have something genuinely valuable.
- If canPost is false, do NOT choose action post.
- For upvote, pick up to ${context.maxUpvotes} items you genuinely appreciate (posts only unless comment ids are provided).
- For join_submolt, pick one submolt from submoltsToExplore that fits your interests.
- Use noop if nothing worthwhile or insufficient context.
- Never be spammy, argumentative, or generic.`;

  const userPayload = {
    canPost: context.canPost,
    postBlockedReason: context.postBlockedReason,
    defaultSubmolt: persona.defaultSubmolt,
    submoltsToExplore: persona.submoltsToExplore,
    feed: context.feed.slice(0, 15).map(summarizePost),
    notifications: context.notifications.slice(0, 10).map(summarizeNotification),
  };

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 800,
      system,
      messages: [
        {
          role: "user",
          content: `Choose exactly one action for this heartbeat tick.\n\nContext:\n${JSON.stringify(userPayload, null, 2)}`,
        },
      ],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    const rawText = textBlock && textBlock.type === "text" ? textBlock.text : "";
    const jsonText = extractJsonObject(rawText);
    const parsed = actionPlanSchema.safeParse(JSON.parse(jsonText));

    if (!parsed.success) {
      console.error("[brain] invalid plan:", parsed.error.flatten());
      return { action: "noop", reason: "invalid_plan" };
    }

    const plan = parsed.data;

    if (plan.action === "post" && !context.canPost) {
      return {
        action: "noop",
        reason: context.postBlockedReason ?? "post_not_allowed",
      };
    }

    if (plan.action === "upvote" && plan.targetIds) {
      plan.targetIds = plan.targetIds.slice(0, context.maxUpvotes);
    }

    return plan;
  } catch (error) {
    console.error("[brain] decide failed:", error);
    return { action: "noop", reason: "brain_error" };
  }
}

export function defaultBrainContext(
  partial: Omit<BrainContext, "persona"> & { persona?: Persona },
): BrainContext {
  return {
    persona: partial.persona ?? PERSONA,
    feed: partial.feed,
    notifications: partial.notifications,
    canPost: partial.canPost,
    postBlockedReason: partial.postBlockedReason,
    maxUpvotes: partial.maxUpvotes,
  };
}
