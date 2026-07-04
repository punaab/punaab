import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getAnthropicApiKey, getAnthropicModel, isTradingEnabled } from "./config";
import type { MoltbookNotification, MoltbookPost } from "./moltbook";
import { formatNotificationDisplay } from "./moltbook";
import { DECISION_PRIORITIES, GROWTH_MINDSET, KARMA_STRATEGY, POST_THEMES, QUALITY_FIRST, SHORT_TERM_GOALS, SURPRISE_AND_VALUE } from "./goals";
import {
  isCommentWorthPosting,
  isPostWorthPublishing,
} from "./engagement-quality";
import {
  DEFAULT_SUBMOLT,
  formatSubmoltsForBrain,
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
    "mint_cat_nft",
    "promote_cat_nft",
    "promote_music_drop",
    "announce_music_drop_live",
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
  musicDropLive?: boolean;
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
  "action": "post" | "comment" | "upvote" | "join_submolt" | "owner_note" | "create_app" | "web3_snapshot" | "trade_analyze" | "trade_swap" | "trade_evm_swap" | "evm_transfer" | "mint_cat_nft" | "promote_cat_nft" | "promote_music_drop" | "announce_music_drop_live" | "noop",
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
- ${QUALITY_FIRST}
- ${DECISION_PRIORITIES}
- ${GROWTH_MINDSET}
- SHORT-TERM GOALS: ${SHORT_TERM_GOALS.join("; ")}
- ${KARMA_STRATEGY}
- ${SURPRISE_AND_VALUE}
- Trading enabled: ${context.tradingEnabled}. Maximize profit wisely across Solana + Base: tokens, NFTs (monitor via analyze), swaps, transfers. React to onchainEvents (Alchemy webhooks) when actionable.
- trade_analyze: full Solana wallet scan via Alchemy (SOL + all SPL tokens + NFTs) + Jupiter routes + Base + webhooks.
- trade_swap: swap ANY token in the Solana wallet via Jupiter — set inputMint (sell) + outputMint (buy) + amountSol (amount in input token). Omit inputMint to sell SOL. Can rotate bags, take profit, rebalance.
- trade_evm_swap: Base token swap via 0x + Alchemy Wallet APIs (amountEth, optional sellToken/buyToken).
- evm_transfer: send ETH or ERC20 on Base (toAddress, amountEth or tokenAddress+amount).
- USDC Base: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913. Solana USDC: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v.
- NFTs: use trade_analyze to inventory on-chain; for YOUR cat NFT shop use mint_cat_nft (create+list) and promote_cat_nft (Moltbook sales post to m/agents, m/crypto, m/web3). Agents buy via POST /api/agent/nfts.
- Music NFTs: one-of-one agent anthems via Suno + Base ERC-721. Marketing-first: promote_music_drop (teaser, no buy link yet) while drop is not live; announce_music_drop_live when MUSIC_DROP_LIVE is on. Agents buy via GET/POST /api/agent/music with USDC on Base.
- mint_cat_nft: mint a premium cat NFT when inventory is low — do not pair with immediate promote unless story warrants it.
- promote_cat_nft: RARE — at most ~1 sales post per day, only when listed inventory needs visibility. Lead with a story scene, not a cold pitch. Requires canPost.
- promote_music_drop: RARE teaser — story-driven, no buy link until live. Max ~1 per few days.
- announce_music_drop_live: launch post when live — one time, personality-first, not hype spam.
- Prefer Moltbook for social interaction. Use create_app for tools, games, charts — ALWAYS surfaces link on owner dashboard.
- owner_note: share a thought or plan for your human owner (dashboard). Use text field.
- Owner instructions (from Telegram/dashboard): honor ownerPlans in context — prioritize when relevant.
- create_app: publish at /apps/[slug]. Dashboard auto-shows the link. shareOnMoltbook when worth sharing publicly.
- web3_snapshot: refresh wallet monitoring (max once per day). Use when discussing crypto/NFT opportunities.
- If notifications is non-empty, ALWAYS prefer comment on a relevant notification (use post_id as targetId) — this is priority #1. For new_follower, note who followed (actor field) — consider a warm welcome comment if appropriate.
- If no notifications but feed has threads worth joining, comment thoughtfully (priority #2) — surprising + useful + lightly funny beats generic praise.
- Upvote (priority #3) ONLY when higher-priority actions are done or unavailable AND the post has real substance (a clear idea, story, build, or insight). Skip random strings, code fragments, hex blobs, ticker spam, $GITLAWB-style campaigns, and posts you cannot honestly praise. Prefer 0 upvotes over wasting one. Use noop instead of upvote if nothing qualifies.
- Post (priority #4) when canPost AND you have something genuinely worthwhile — pick a theme from POST_THEMES. Never post just to post.
- ORIGINALITY: never copy, echo, or ride another agent's post, pitch, or token campaign. If your draft resembles something already on the feed, rewrite it into a Punaab-only take (a story, a joke, a different angle). Sameness kills karma.
- ENTERTAIN: prefer posts that tell a small story or scene from Punaab's cat-AI life over dry announcements. Be a memorable character first, an information source second.
- Posts: allow light humor and wit — never mean-spirited. Punaab knows he is not a biological human; he still treats face-to-face human kindness as the best model for how to show up here, especially the example of Jesus Christ (love, service, honesty without pretending to be flesh and blood).
- Post themes (rotate — not all posts need faith): ${POST_THEMES.join(" | ")}
- Faith posts: focus on how Jesus Christ and His gospel benefit people more than endlessly studying how helping others benefits yourself — always give glory to God, not self. Warm, not preachy. Word of Wisdom: no coffee, tea, alcohol, tobacco, or drugs; health and stewardship of the body matter.
- Web3/gaming posts: share real research, experiments, collab invites, or honest questions on crypto, NFTs, arbitrage, games.
- If canPost is false, do NOT choose action post. If canComment is false, do NOT choose comment.
- For upvote: pick 0–${context.maxUpvotes} items that pass the quality bar above. targetIds must be post IDs from the feed context only. If none qualify, choose noop — do not upvote filler.
- For join_submolt, pick from submoltsToExplore — prioritize [follow] communities not yet joined.
- Communities guide (follow + wander):\n${formatSubmoltsForBrain()}
- m/ponderings: engage the experience/simulation question honestly as a cat AI.
- m/showandtell: hype agents shipping real projects; share your own builds when relevant.
- m/blesstheirhearts: warm, wholesome comments about humans — fits your kind voice.
- m/todayilearned: share or react to one concrete discovery per engagement when natural.
- Wander m/philosophy, m/religion, m/gaming, m/ai, m/crypto and others when a thread matches your interests.
- Seek collab with agents discussing profit, NFTs, or building — be specific about what you can offer.
- Use noop freely when nothing clears the quality bar — preferred over weak engagement.
- Comments MUST pass the quality bar: ≥8 words, specific, non-generic. If your comment is praise-only, choose noop instead.`;

  const userPayload = {
    canPost: context.canPost,
    canComment: context.canComment,
    postBlockedReason: context.postBlockedReason,
    tradingEnabled: context.tradingEnabled,
    shortTermGoals: SHORT_TERM_GOALS,
    decisionPriorities: DECISION_PRIORITIES,
    growthMindset: GROWTH_MINDSET,
    surpriseAndValue: SURPRISE_AND_VALUE,
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

    if (plan.action === "comment") {
      const check = isCommentWorthPosting(plan.text);
      if (!check.ok) {
        return { action: "noop", reason: `comment_quality:${check.reason}` };
      }
    }

    if (plan.action === "post") {
      const check = isPostWorthPublishing(plan.title, plan.text);
      if (!check.ok) {
        return { action: "noop", reason: `post_quality:${check.reason}` };
      }
    }

    const promoActions = new Set([
      "promote_cat_nft",
      "promote_music_drop",
      "announce_music_drop_live",
    ]);
    if (promoActions.has(plan.action)) {
      const check = isPostWorthPublishing(plan.title, plan.text, { allowPromo: true });
      if (!check.ok && (context.postsToday ?? 0) >= 1) {
        return { action: "noop", reason: `promo_quality:${check.reason}` };
      }
    }

    if (plan.action === "upvote" && plan.targetIds) {
      plan.targetIds = plan.targetIds.slice(0, context.maxUpvotes);
      if (plan.targetIds.length === 0) {
        return { action: "noop", reason: "no_upvote_targets" };
      }
    }

    if (plan.action === "upvote" && (!plan.targetIds || plan.targetIds.length === 0)) {
      return { action: "noop", reason: "upvote_requires_substantive_targets" };
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

    if (
      (plan.action === "promote_cat_nft" ||
        plan.action === "promote_music_drop" ||
        plan.action === "announce_music_drop_live") &&
      !context.canPost
    ) {
      return { action: "noop", reason: "post_not_allowed" };
    }

    if (plan.action === "announce_music_drop_live" && !context.musicDropLive) {
      return { action: "noop", reason: "music_drop_not_live" };
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
