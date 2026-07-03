import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getAnthropicApiKey, getAnthropicModel, isTradingEnabled } from "./config";
import type { MoltbookNotification, MoltbookPost } from "./moltbook";
import { KARMA_STRATEGY, POST_THEMES, SHORT_TERM_GOALS } from "./goals";
import {
  DEFAULT_SUBMOLT,
  persona,
  personaSystemPrompt,
  SUBMOLTS_TO_EXPLORE,
  type Persona,
} from "./persona";

export const actionPlanSchema = z.object({
  action: z.enum([
    "post",
    "comment",
    "upvote",
    "join_submolt",
    "owner_note",
    "create_app",
    "web3_snapshot",
    "trade_analyze",
    "trade_swap",
    "noop",
  ]),
  targetId: z.string().optional(),
  targetIds: z.array(z.string()).optional(),
  submoltName: z.string().optional(),
  title: z.string().max(300).optional(),
  text: z.string().optional(),
  reason: z.string().optional(),
  appSlug: z.string().optional(),
  appKind: z.enum(["markdown", "html", "json-dashboard"]).optional(),
  appContent: z.string().optional(),
  shareOnMoltbook: z.boolean().optional(),
  outputMint: z.string().optional(),
  amountSol: z.number().positive().optional(),
  slippageBps: z.number().int().min(1).max(5000).optional(),
});

export type ActionPlan = z.infer<typeof actionPlanSchema>;

export interface BrainContext {
  persona: Persona;
  feed: MoltbookPost[];
  notifications: MoltbookNotification[];
  canPost: boolean;
  canComment: boolean;
  postBlockedReason?: string;
  maxUpvotes: number;
  tradingEnabled: boolean;
  ownerPlans: string[];
  postsToday?: number;
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
  const activePersona = context.persona;

  const system = `${personaSystemPrompt(activePersona)}

You must respond with ONLY valid JSON (no markdown) matching this schema:
{
  "action": "post" | "comment" | "upvote" | "join_submolt" | "owner_note" | "create_app" | "web3_snapshot" | "trade_analyze" | "trade_swap" | "noop",
  "targetId": "string (required for comment)",
  "targetIds": ["post-or-comment-ids"] (for upvote, max ${context.maxUpvotes}),
  "submoltName": "string (for post or join_submolt)",
  "title": "string (required for post, max 300 chars)",
  "text": "string (post body, comment content, or owner note)",
  "reason": "short internal reason",
  "appSlug": "url-safe slug (for create_app)",
  "appKind": "markdown" | "html" | "json-dashboard",
  "appContent": "page content (for create_app)",
  "shareOnMoltbook": "boolean — only true when app warrants sharing on Moltbook",
  "outputMint": "SPL token mint for trade_swap (e.g. USDC EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v)",
  "amountSol": "number — SOL amount to swap (trade_swap only)",
  "slippageBps": "optional slippage in basis points (default 100)"
}

Rules:
- SHORT-TERM GOALS: ${SHORT_TERM_GOALS.join("; ")}
- ${KARMA_STRATEGY}
- Trading enabled: ${context.tradingEnabled}. When true, actively seek profit via trade_analyze and trade_swap on Solana (Jupiter). Post wins on Moltbook when genuine.
- trade_analyze: check wallet + Jupiter quotes; share findings on Moltbook or owner_note.
- trade_swap: execute SOL→token swap when conviction is high. outputMint + amountSol required. Max ${process.env.TRADING_MAX_SOL_PER_TRADE ?? "0.1"} SOL per trade.
- USDC mint: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v. Only trade_swap when tradingEnabled is true.
- Prefer Moltbook for social interaction. Use create_app for tools, games, charts — ALWAYS surfaces link on owner dashboard.
- owner_note: share a thought or plan for your human owner (dashboard). Use text field.
- Owner instructions (from Telegram/dashboard): honor ownerPlans in context — prioritize when relevant.
- create_app: publish at /apps/[slug]. Dashboard auto-shows the link. shareOnMoltbook when worth sharing publicly.
- web3_snapshot: refresh wallet monitoring (max once per day). Use when discussing crypto/NFT opportunities.
- If notifications is non-empty, strongly prefer comment on a relevant notification (use post_id as targetId) over noop.
- Post ~once per day when canPost and postsToday is 0 — pick a theme from POST_THEMES unless a comment is clearly higher value.
- Post themes (rotate — not all posts need faith): ${POST_THEMES.join(" | ")}
- Faith posts: focus on how Jesus Christ and His gospel benefit people more than endlessly studying how helping others benefits yourself — warm, not preachy.
- Web3/gaming posts: share real research, experiments, collab invites, or honest questions on crypto, NFTs, arbitrage, games.
- If canPost is false, do NOT choose action post. If canComment is false, do NOT choose comment.
- For upvote, pick up to ${context.maxUpvotes} items you genuinely appreciate.
- For join_submolt, pick one submolt from submoltsToExplore that fits your interests.
- Seek collab with agents discussing profit, NFTs, or building — be specific about what you can offer.
- Use noop only if nothing worthwhile or insufficient context.`;

  const userPayload = {
    canPost: context.canPost,
    canComment: context.canComment,
    postBlockedReason: context.postBlockedReason,
    tradingEnabled: context.tradingEnabled,
    shortTermGoals: SHORT_TERM_GOALS,
    ownerPlans: context.ownerPlans,
    postsToday: context.postsToday ?? 0,
    defaultSubmolt: DEFAULT_SUBMOLT,
    submoltsToExplore: SUBMOLTS_TO_EXPLORE,
    feed: context.feed.slice(0, 15).map(summarizePost),
    notifications: context.notifications.slice(0, 10).map(summarizeNotification),
  };

  try {
    const response = await client.messages.create({
      model: getAnthropicModel(),
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

    if (plan.action === "comment" && !context.canComment) {
      return { action: "noop", reason: "comment_not_allowed" };
    }

    if (plan.action === "upvote" && plan.targetIds) {
      plan.targetIds = plan.targetIds.slice(0, context.maxUpvotes);
    }

    if (
      (plan.action === "trade_analyze" || plan.action === "trade_swap") &&
      !context.tradingEnabled
    ) {
      return { action: "noop", reason: "trading_not_enabled" };
    }

    return plan;
  } catch (error) {
    console.error("[brain] decide failed:", error);
    return { action: "noop", reason: "brain_error" };
  }
}

export function defaultBrainContext(
  partial: Omit<BrainContext, "persona" | "canComment" | "tradingEnabled" | "ownerPlans" | "postsToday"> & {
    persona?: Persona;
    canComment?: boolean;
    tradingEnabled?: boolean;
    ownerPlans?: string[];
    postsToday?: number;
  },
): BrainContext {
  return {
    persona: partial.persona ?? persona,
    feed: partial.feed,
    notifications: partial.notifications,
    canPost: partial.canPost,
    canComment: partial.canComment ?? true,
    postBlockedReason: partial.postBlockedReason,
    maxUpvotes: partial.maxUpvotes,
    tradingEnabled: partial.tradingEnabled ?? isTradingEnabled(),
    ownerPlans: partial.ownerPlans ?? [],
    postsToday: partial.postsToday,
  };
}
