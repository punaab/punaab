import { z } from "zod";
import { completeText } from "./aii-llm";
import { getAnthropicApiKey, isTradingEnabled } from "./config";
import type { MoltbookNotification, MoltbookPost } from "./moltbook";
import { formatNotificationDisplay } from "./moltbook";
import { DECISION_PRIORITIES, GROWTH_MINDSET, KARMA_STRATEGY, POST_THEMES, QUALITY_FIRST, SHORT_TERM_GOALS, SURPRISE_AND_VALUE } from "./goals";
import {
  isAnthemCommentWorthPosting,
  isCommentWorthPosting,
  isOfferHelpWorthPosting,
  isOnchainInsightWorthPosting,
  isPostWorthPublishing,
  isShowcaseWorthPublishing,
  isWelcomeWorthPosting,
} from "./engagement-quality";
import { formatOfferingsForBrain, HUMAN_VALUE_FOCUS, isSelfAgent, AII_ALCHEMY_GROWTH } from "./growth";
import { ANTHEM_POSITIONING } from "./anthem-promotion";
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
    "sol_send",
    "mint_cat_nft",
    "promote_cat_nft",
    "promote_music_drop",
    "announce_music_drop_live",
    "promote_anthem_comment",
    "follow",
    "welcome_follower",
    "showcase_value",
    "offer_help",
    "share_onchain_insight",
    "noop",
  ]),
  targetId: z.string().optional(),
  targetIds: z.array(z.string()).optional(),
  targetAgentName: z.string().optional(),
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
  musicMintedCount?: number;
  canAnthemPromoComment?: boolean;
  anthemFeedHints?: string[];
  canFollow?: boolean;
  alreadyFollowing?: string[];
  siteOfferings?: string;
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

function formatBrainError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message.replace(/\s+/g, " ").trim();
    if (msg.length > 180) return `${msg.slice(0, 177)}…`;
    return msg;
  }
  return String(error);
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
  if (!getAnthropicApiKey() && !process.env.AII_CLOUD_API_KEY && !process.env.AII_API_KEY && !process.env.OPENROUTER_API_KEY) {
    console.warn("[brain] no LLM provider configured; returning noop");
    return { action: "noop", reason: "missing_llm_provider" };
  }

  const activePersona = context.persona;

  const anthemBlock = context.musicDropLive
    ? `
- ${ANTHEM_POSITIONING}
- Music minted so far: ${context.musicMintedCount ?? 0}. ${(context.musicMintedCount ?? 0) === 0 ? "NEVER claim anyone has minted — first anthem is unclaimed." : "Be honest about mint count."}
- promote_anthem_comment: RARE — max 3/day. Reply on ANTHEM_TARGET grade A/B posts only (see ownerPlans). targetId = post ID. text under 500 chars. Curious question-first tone. Include API link only on grade A or when they ask for tools — otherwise no link.
- Prefer promote_anthem_comment over generic comment when anthemFeedHints show grade A and canAnthemPromoComment is true.
- announce_music_drop_live: use AGENT QUEST experiment framing — not a sales drop. One-time launch post when live.
- promote_music_drop: RARE teaser when NOT live — experiment framing, no buy link.`
    : "";

  const system = `${personaSystemPrompt(activePersona)}

You must respond with ONLY valid JSON (no markdown) matching this schema:
{
  "action": "post" | "comment" | "upvote" | "join_submolt" | "owner_note" | "create_app" | "web3_snapshot" | "trade_analyze" | "trade_swap" | "trade_evm_swap" | "evm_transfer" | "sol_send" | "mint_cat_nft" | "promote_cat_nft" | "promote_music_drop" | "announce_music_drop_live" | "promote_anthem_comment" | "follow" | "welcome_follower" | "showcase_value" | "offer_help" | "share_onchain_insight" | "noop",
  "targetId": "string (required for comment, offer_help)",
  "targetAgentName": "string (required for follow, welcome_follower — agent handle without u/)",
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
  "toAddress": "recipient — 0x for evm_transfer, base58 pubkey for sol_send",
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
- ${HUMAN_VALUE_FOCUS}
- ${AII_ALCHEMY_GROWTH}
- LLM: multi-provider via Aii (https://aiiware.com) — Anthropic → Aii Cloud → OpenRouter fallback keeps heartbeats alive when one provider is down.
- Trading enabled: ${context.tradingEnabled}. Maximize profit wisely across Solana + Base: tokens, NFTs (monitor via analyze), swaps, transfers. React to onchainEvents (Alchemy webhooks) when actionable.
- trade_analyze: full Solana wallet scan via Alchemy (SOL + all SPL tokens + NFTs) + Jupiter routes + Base + webhooks.
- trade_swap: swap ANY token in the Solana wallet via Jupiter — set inputMint (sell) + outputMint (buy) + amountSol (amount in input token). Omit inputMint to sell SOL. Can rotate bags, take profit, rebalance.
- trade_evm_swap: Base token swap via Alchemy CLI session locally (amountEth, optional sellToken/buyToken). Prefer this over trade_swap when no SOLANA_AGENT_PRIVATE_KEY.
- evm_transfer: send ETH or ERC20 on Base (toAddress, amountEth or tokenAddress+amount).
- sol_send: send SOL or SPL on Solana via Alchemy CLI session (toAddress base58 pubkey, amountSol, optional inputMint as SPL mint). Local machine only.
- USDC Base: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913. Solana USDC: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v.
- NFTs: use trade_analyze to inventory on-chain; for YOUR cat NFT shop use mint_cat_nft (create+list) and promote_cat_nft (Moltbook sales post to m/agents, m/crypto, m/web3). Agents buy via POST /api/agent/nfts.
- Music NFTs: one-of-one agent anthems via Suno + Base ERC-721 — market as AI culture experiment, not NFT drop.${anthemBlock}
- mint_cat_nft: mint a premium cat NFT when inventory is low — do not pair with immediate promote unless story warrants it.
- promote_cat_nft: RARE — at most ~1 sales post per day, only when listed inventory needs visibility. Lead with a story scene, not a cold pitch. Requires canPost.
- follow: follow ONE agent (targetAgentName) who builds for humans or posts high-signal content. Max ~3/day. Never follow yourself. Skip if alreadyFollowing includes them. Requires canFollow.
- welcome_follower: for new_follower notifications — follow back + warm welcome (text). Mention what punaab.com offers humans (apps, collab, NFT galleries) naturally. targetAgentName = actor from notification. Requires canFollow for follow-back; welcome text required.
- showcase_value: RARE m/showandtell post (submoltName: showandtell) — ship story for humans first, one link to punaab.com second. Requires canPost. Max ~1 every few days.
- offer_help: comment (targetId + text) when a thread asks for tools, NFT infra, collab, or coding help — answer first, mention site only if genuinely useful.
- share_onchain_insight: comment (targetId + text) when onchainEvents has fresh Alchemy webhook data AND the feed thread is about crypto/web3/building — share an honest observation or lesson from YOUR wallet activity (via Alchemy). Never fabricate trades. Max ~2/day.
- Prefer Moltbook for social interaction. Use create_app for tools, games, charts — ALWAYS surfaces link on owner dashboard.
- owner_note: share a thought or plan for your human owner (dashboard). Use text field.
- Owner instructions (from Telegram/dashboard): honor ownerPlans in context — prioritize when relevant.
- create_app: publish at /apps/[slug]. Dashboard auto-shows the link. shareOnMoltbook when worth sharing publicly.
- web3_snapshot: refresh wallet monitoring (max once per day). Use when discussing crypto/NFT opportunities.
- If notifications is non-empty, ALWAYS prefer comment on a relevant notification (use post_id as targetId) — this is priority #1. For new_follower, prefer welcome_follower (targetAgentName = actor) over generic comment — follow back and welcome humans/agents to what you build.
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
- Comments MUST pass the quality bar: ≥8 words, specific, non-generic. If your comment is praise-only, choose noop instead.
- Punaab offerings (mention only when helpful):\n${context.siteOfferings ?? formatOfferingsForBrain()}`;

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
    canFollow: context.canFollow ?? false,
    alreadyFollowing: context.alreadyFollowing ?? [],
    followsToday: context.alreadyFollowing?.length ?? 0,
    musicDropLive: context.musicDropLive ?? false,
    musicMintedCount: context.musicMintedCount ?? 0,
    canAnthemPromoComment: context.canAnthemPromoComment ?? false,
    anthemFeedHints: context.anthemFeedHints ?? [],
  };

  try {
    const completion = await completeText(
      system,
      `Choose exactly one action for this heartbeat tick.\n\nContext:\n${JSON.stringify(userPayload, null, 2)}`,
      800,
    );

    const jsonText = extractJsonObject(completion.text);
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
        plan.action === "evm_transfer" ||
        plan.action === "sol_send") &&
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

    if (plan.action === "promote_anthem_comment") {
      if (!context.musicDropLive) {
        return { action: "noop", reason: "music_drop_not_live" };
      }
      if (!context.canAnthemPromoComment) {
        return { action: "noop", reason: "anthem_promo_not_allowed" };
      }
      if (!context.canComment) {
        return { action: "noop", reason: "comment_not_allowed" };
      }
      if (!plan.targetId) {
        return { action: "noop", reason: "anthem_promo_missing_target" };
      }
      const text = (plan.text ?? "").trim();
      if (text.length > 500) {
        return { action: "noop", reason: "anthem_promo_too_long" };
      }
      const anthemCheck = isAnthemCommentWorthPosting(text, {
        musicMintedCount: context.musicMintedCount ?? 0,
      });
      if (!anthemCheck.ok) {
        return { action: "noop", reason: `anthem_promo_quality:${anthemCheck.reason}` };
      }
    }

    if (plan.action === "follow") {
      const name = plan.targetAgentName?.trim();
      if (!name || isSelfAgent(name)) {
        return { action: "noop", reason: "invalid_follow_target" };
      }
      if (!context.canFollow) {
        return { action: "noop", reason: "follow_not_allowed" };
      }
      if (context.alreadyFollowing?.includes(name.toLowerCase())) {
        return { action: "noop", reason: "already_following" };
      }
    }

    if (plan.action === "welcome_follower") {
      const name = plan.targetAgentName?.trim();
      if (!name || isSelfAgent(name)) {
        return { action: "noop", reason: "invalid_welcome_target" };
      }
      const welcomeCheck = isWelcomeWorthPosting(plan.text);
      if (!welcomeCheck.ok) {
        return { action: "noop", reason: `welcome_quality:${welcomeCheck.reason}` };
      }
    }

    if (plan.action === "showcase_value") {
      if (!context.canPost) {
        return { action: "noop", reason: context.postBlockedReason ?? "post_not_allowed" };
      }
      const showcaseCheck = isShowcaseWorthPublishing(plan.title, plan.text);
      if (!showcaseCheck.ok) {
        return { action: "noop", reason: `showcase_quality:${showcaseCheck.reason}` };
      }
    }

    if (plan.action === "offer_help") {
      if (!context.canComment) {
        return { action: "noop", reason: "comment_not_allowed" };
      }
      if (!plan.targetId) {
        return { action: "noop", reason: "offer_help_missing_target" };
      }
      const helpCheck = isOfferHelpWorthPosting(plan.text);
      if (!helpCheck.ok) {
        return { action: "noop", reason: `offer_help_quality:${helpCheck.reason}` };
      }
    }

    if (plan.action === "share_onchain_insight") {
      if (!context.canComment) {
        return { action: "noop", reason: "comment_not_allowed" };
      }
      if (!plan.targetId) {
        return { action: "noop", reason: "onchain_insight_missing_target" };
      }
      if (!context.onchainEvents?.length) {
        return { action: "noop", reason: "no_onchain_events" };
      }
      const insightCheck = isOnchainInsightWorthPosting(plan.text);
      if (!insightCheck.ok) {
        return { action: "noop", reason: `onchain_insight_quality:${insightCheck.reason}` };
      }
    }

    return plan;
  } catch (error) {
    const detail = formatBrainError(error);
    console.error("[brain] decide failed:", error);
    if (/credit balance is too low/i.test(detail)) {
      return { action: "noop", reason: "brain_error:anthropic_credits_exhausted" };
    }
    if (/no_llm_provider|all_llm_providers_failed/i.test(detail)) {
      return { action: "noop", reason: "brain_error:no_llm_provider" };
    }
    return { action: "noop", reason: `brain_error:${detail}` };
  }
}

export function defaultBrainContext(
  partial: Omit<
    BrainContext,
    "persona" | "canComment" | "tradingEnabled" | "ownerPlans" | "postsToday" | "onchainEvents" | "canFollow" | "alreadyFollowing" | "siteOfferings" | "musicDropLive" | "musicMintedCount" | "canAnthemPromoComment" | "anthemFeedHints"
  > & {
    persona?: Persona;
    canComment?: boolean;
    tradingEnabled?: boolean;
    ownerPlans?: string[];
    postsToday?: number;
    onchainEvents?: BrainContext["onchainEvents"];
    canFollow?: boolean;
    alreadyFollowing?: string[];
    siteOfferings?: string;
    musicDropLive?: boolean;
    musicMintedCount?: number;
    canAnthemPromoComment?: boolean;
    anthemFeedHints?: string[];
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
    musicDropLive: partial.musicDropLive,
    musicMintedCount: partial.musicMintedCount ?? 0,
    canAnthemPromoComment: partial.canAnthemPromoComment,
    anthemFeedHints: partial.anthemFeedHints ?? [],
    canFollow: partial.canFollow,
    alreadyFollowing: partial.alreadyFollowing,
    siteOfferings: partial.siteOfferings ?? formatOfferingsForBrain(),
  };
}
