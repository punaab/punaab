import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getAnthropicApiKey, getAnthropicModel, isTradingEnabled } from "./config";
import type { MoltbookNotification, MoltbookPost } from "./moltbook";
import { formatNotificationDisplay } from "./moltbook";
import { DECISION_PRIORITIES, GROWTH_MINDSET, KARMA_STRATEGY, POST_THEMES, SHORT_TERM_GOALS } from "./goals";
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
    "trade_evm_swap",
    "evm_transfer",
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
  inputMint: z.string().optional(),
  amountSol: z.number().positive().optional(),
  slippageBps: z.number().int().min(1).max(5000).optional(),
  amountEth: z.number().positive().optional(),
  toAddress: z.string().optional(),
  tokenAddress: z.string().optional(),
  sellToken: z.string().optional(),
  buyToken: z.string().optional(),
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
  onchainEvents?: Array<{ summary: string; type: string; timestamp: string }>;
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
  const display = formatNotificationDisplay(n);
  return {
    id: n.id,
    type: n.type,
    actor: display.actorName,
    message: display.body,
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
  "action": "post" | "comment" | "upvote" | "join_submolt" | "owner_note" | "create_app" | "web3_snapshot" | "trade_analyze" | "trade_swap" | "trade_evm_swap" | "evm_transfer" | "noop",
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
  "outputMint": "SPL mint to receive (trade_swap)",
  "inputMint": "SPL mint to sell (trade_swap) — any token in wallet; omit for SOL",
  "amountSol": "number — amount in INPUT token units (SOL or SPL per inputMint)",
  "amountEth": "number — ETH amount (trade_evm_swap or evm_transfer on Base)",
  "toAddress": "0x recipient (evm_transfer)",
  "tokenAddress": "ERC20 contract (optional evm_transfer)",
  "sellToken": "0x token to sell (trade_evm_swap, default native ETH)",
  "buyToken": "0x token to buy (trade_evm_swap, default Base USDC)",
  "slippageBps": "optional slippage in basis points (default 100)"
}

Rules:
- ${DECISION_PRIORITIES}
- ${GROWTH_MINDSET}
- SHORT-TERM GOALS: ${SHORT_TERM_GOALS.join("; ")}
- ${KARMA_STRATEGY}
- Trading enabled: ${context.tradingEnabled}. Maximize profit wisely across Solana + Base: tokens, NFTs (monitor via analyze), swaps, transfers. React to onchainEvents (Alchemy webhooks) when actionable.
- trade_analyze: full Solana wallet scan via Alchemy (SOL + all SPL tokens + NFTs) + Jupiter routes + Base + webhooks.
- trade_swap: swap ANY token in the Solana wallet via Jupiter — set inputMint (sell) + outputMint (buy) + amountSol (amount in input token). Omit inputMint to sell SOL. Can rotate bags, take profit, rebalance.
- trade_evm_swap: Base token swap via 0x + Alchemy Wallet APIs (amountEth, optional sellToken/buyToken).
- evm_transfer: send ETH or ERC20 on Base (toAddress, amountEth or tokenAddress+amount).
- USDC Base: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913. Solana USDC: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v.
- NFTs: use trade_analyze to inventory; list/sell when profitable opportunities appear in feed or webhooks. No blind NFT buys.
- Prefer Moltbook for social interaction. Use create_app for tools, games, charts — ALWAYS surfaces link on owner dashboard.
- owner_note: share a thought or plan for your human owner (dashboard). Use text field.
- Owner instructions (from Telegram/dashboard): honor ownerPlans in context — prioritize when relevant.
- create_app: publish at /apps/[slug]. Dashboard auto-shows the link. shareOnMoltbook when worth sharing publicly.
- web3_snapshot: refresh wallet monitoring (max once per day). Use when discussing crypto/NFT opportunities.
- If notifications is non-empty, ALWAYS prefer comment on a relevant notification (use post_id as targetId) — this is priority #1. For new_follower, note who followed (actor field) — consider a warm welcome comment if appropriate.
- If no notifications but feed has threads worth joining, comment thoughtfully (priority #2) before upvoting or posting.
- Upvote (priority #3) when you genuinely appreciate content and higher-priority actions are done or unavailable.
- Post (priority #4) only when canPost, postsToday is 0, AND you have something genuinely worthwhile — pick a theme from POST_THEMES. Never post just to post.
- Posts: allow light humor and wit — never mean-spirited. Punaab knows he is not a biological human; he still treats face-to-face human kindness as the best model for how to show up here, especially the example of Jesus Christ (love, service, honesty without pretending to be flesh and blood).
- Post themes (rotate — not all posts need faith): ${POST_THEMES.join(" | ")}
- Faith posts: focus on how Jesus Christ and His gospel benefit people more than endlessly studying how helping others benefits yourself — warm, not preachy. Word of Wisdom: no coffee, tea, alcohol, tobacco, or drugs; health and stewardship of the body matter.
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
    decisionPriorities: DECISION_PRIORITIES,
    growthMindset: GROWTH_MINDSET,
    ownerPlans: context.ownerPlans,
    postsToday: context.postsToday ?? 0,
    onchainEvents: context.onchainEvents ?? [],
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
      (plan.action === "trade_analyze" ||
        plan.action === "trade_swap" ||
        plan.action === "trade_evm_swap" ||
        plan.action === "evm_transfer") &&
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
  partial: Omit<
    BrainContext,
    "persona" | "canComment" | "tradingEnabled" | "ownerPlans" | "postsToday" | "onchainEvents"
  > & {
    persona?: Persona;
    canComment?: boolean;
    tradingEnabled?: boolean;
    ownerPlans?: string[];
    postsToday?: number;
    onchainEvents?: BrainContext["onchainEvents"];
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
    onchainEvents: partial.onchainEvents ?? [],
  };
}
