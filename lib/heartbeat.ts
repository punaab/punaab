import { decide, defaultBrainContext } from "@/lib/brain";
import { AGENT_LIMITS, allowedActions, getSiteUrl } from "@/lib/config";
import { saveApp, slugify } from "@/lib/apps";
import {
  getSeenPostIds,
  getUsageCounts,
  getFollowedAgents,
  isAgentFollowed,
  recordComment,
  recordFollow,
  recordPost,
  recordSeenPostIds,
  recordUpvote,
} from "@/lib/memory";
import {
  MoltbookClient,
  MoltbookError,
  type MoltbookNotification,
  type MoltbookPost,
} from "@/lib/moltbook";
import {
  appendActivity,
  appendPlan,
  appendTickLog,
  addPublishedLink,
  setCurrentThought,
  setLastHeartbeat,
} from "@/lib/owner-state";
import { filterUpvoteTargets } from "@/lib/upvote-quality";
import {
  isCommentWorthPosting,
  isOfferHelpWorthPosting,
  isOnchainInsightWorthPosting,
  isPostWorthPublishing,
  isShowcaseWorthPublishing,
  isWelcomeWorthPosting,
} from "@/lib/engagement-quality";
import { formatOfferingsForBrain, isSelfAgent, buildAlchemyContextForBrain } from "@/lib/growth";
import { SHORT_TERM_GOALS } from "@/lib/goals";
import {
  captureWeb3Snapshot,
  shouldRunWeb3Snapshot,
} from "@/lib/web3-monitor";
import {
  analyzeTradingOpportunity,
  executeSwap,
  executeSolanaSend,
  MINT_USDC,
} from "@/lib/trading";
import { getRecentAlchemyEvents } from "@/lib/alchemy-events";
import {
  getMusicCampaign,
  getNextPendingStep,
  markMusicStepFailed,
  markMusicStepPosted,
} from "@/lib/campaign";
import {
  catNftGalleryUrl,
  catNftOwnerPlanHint,
  formatCatNftForSalePost,
  getListedCatNfts,
  markCatNftPromoted,
  mintCatNft,
} from "@/lib/punaab-cat-nfts";
import {
  formatMusicDropLivePost,
  formatMusicDropTeaserPost,
  isMusicDropLiveAsync,
  musicDropGalleryUrl,
} from "@/lib/music-nft";
import { executeEvmSwap, executeEvmTransfer } from "@/lib/trading-evm";
import { isTradingEnabled } from "@/lib/config";
import { DEFAULT_SUBMOLT, SUBMOLTS_TO_EXPLORE } from "@/lib/persona";
import { ensureSubmoltsJoined, submoltEngagementHint } from "@/lib/submolt-membership";

export interface TickSummary {
  ok: boolean;
  timestamp: string;
  feedCount: number;
  newPostCount: number;
  notificationCount: number;
  canPost: boolean;
  postBlockedReason?: string;
  campaignStatus?: string;
  campaignBlockedReason?: string;
  plan: { action: string; reason?: string };
  executed: string[];
  errors: string[];
}

function getPostId(post: MoltbookPost): string | null {
  const id = post.id?.trim();
  return id ? id : null;
}

export async function runHeartbeatTick(
  options: { prioritizeCampaign?: boolean } = {},
): Promise<TickSummary> {
  const prioritizeCampaign = options.prioritizeCampaign === true;
  const summary: TickSummary = {
    ok: true,
    timestamp: new Date().toISOString(),
    feedCount: 0,
    newPostCount: 0,
    notificationCount: 0,
    canPost: false,
    plan: { action: "noop" },
    executed: [],
    errors: [],
  };
  const client = new MoltbookClient();

  try {
    await setLastHeartbeat(summary.timestamp);

    const joinedNow = await ensureSubmoltsJoined(client);
    if (joinedNow.length) {
      summary.executed.push(`joined:${joinedNow.join(",")}`);
    }

    // Seed short-term goals on first run if plans are empty
    const { getPlans } = await import("@/lib/owner-state");
    const existingPlans = await getPlans();
    if (existingPlans.length === 0) {
      for (const goal of SHORT_TERM_GOALS) {
        await appendPlan(goal);
      }
    }

    let feedPosts: MoltbookPost[] = [];
    let notifications: MoltbookNotification[] = [];

    try {
      const feed = await client.getFeed({
        sort: "new",
        limit: AGENT_LIMITS.FEED_LIMIT,
      });
      feedPosts = feed.posts;
      summary.feedCount = feedPosts.length;
    } catch (error) {
      const message = formatError("getFeed", error);
      summary.errors.push(message);
      console.error(message);
    }

    try {
      const notif = await client.getNotifications({
        limit: AGENT_LIMITS.NOTIFICATIONS_LIMIT,
      });
      notifications = notif.notifications;
      summary.notificationCount = notifications.length;
    } catch (error) {
      const message = formatError("getNotifications", error);
      summary.errors.push(message);
      console.error(message);
    }

    const seen = await getSeenPostIds();
    const unseenPosts = feedPosts.filter((post) => {
      const id = getPostId(post);
      return id ? !seen.has(id) : false;
    });

    const newIds = unseenPosts
      .map(getPostId)
      .filter((id): id is string => Boolean(id));

    if (newIds.length > 0) {
      await recordSeenPostIds(newIds);
    }
    summary.newPostCount = newIds.length;

    const usage = await getUsageCounts();
    const allowance = allowedActions(usage);
    summary.canPost = allowance.canPost;
    if (!allowance.canPost) {
      if (allowance.inQuietHours) {
        summary.postBlockedReason = "quiet_hours";
      } else if (usage.msSinceLastPost < AGENT_LIMITS.MIN_POST_INTERVAL_MS) {
        summary.postBlockedReason = "min_interval";
      } else if (usage.postsThisHour >= AGENT_LIMITS.MAX_POSTS_PER_HOUR) {
        summary.postBlockedReason = "hourly_limit";
      } else {
        summary.postBlockedReason = "daily_limit";
      }
    }

    const contextPosts =
      unseenPosts.length > 0 ? unseenPosts : feedPosts;

    const ownerPlans = (await getPlans())
      .filter((p) => p.status === "active")
      .map((p) => p.text);

    const listedCats = await getListedCatNfts().catch(() => []);
    const catNftHint = catNftOwnerPlanHint(listedCats.length);
    const communityHint = submoltEngagementHint();

    const musicCampaign =
      (await getMusicCampaign().catch(() => null)) ?? null;
    const musicCampaignActive = musicCampaign?.status === "active";
    const nextMusicStep =
      musicCampaign && musicCampaignActive ? getNextPendingStep(musicCampaign) : null;
    const unreadNotifications = notifications.filter((n) => !n.read);

    summary.campaignStatus = musicCampaign?.status ?? "none";

    const canRunMusicCampaignPost =
      musicCampaignActive &&
      nextMusicStep &&
      allowance.canPost &&
      (prioritizeCampaign || unreadNotifications.length === 0);

    if (canRunMusicCampaignPost && musicCampaign && nextMusicStep) {
      try {
        try {
          await client.joinSubmolt(nextMusicStep.submolt);
          summary.executed.push(`joined:${nextMusicStep.submolt}`);
        } catch (joinError) {
          console.warn("[heartbeat] music campaign joinSubmolt:", joinError);
        }

        const result = await client.createPost({
          submolt_name: nextMusicStep.submolt,
          title: nextMusicStep.title,
          content: nextMusicStep.content,
        });
        await recordPost();
        const postUrl = `https://www.moltbook.com/post/${result.post.id}`;
        summary.executed.push(`music_campaign_posted:${nextMusicStep.id}`);
        summary.plan = {
          action: "post",
          reason: `music-campaign:${musicCampaign.ticker}:${nextMusicStep.id}`,
        };

        await markMusicStepPosted(nextMusicStep.id, result.post.id, postUrl);
        await appendActivity({
          action: "post",
          summary: `[${musicCampaign.ticker}] ${nextMusicStep.label}`,
          content: nextMusicStep.title,
          targetId: result.post.id,
          targetUrl: postUrl,
          reason: `music campaign m/${nextMusicStep.submolt}`,
        });
        await setCurrentThought(
          `Music campaign ${musicCampaign.ticker}: posted "${nextMusicStep.label}" to m/${nextMusicStep.submolt}`,
        );
        await appendTickLog(summary);
        return summary;
      } catch (error) {
        const message = formatError("music_campaign_post", error);
        summary.errors.push(message);
        await markMusicStepFailed(nextMusicStep.id, message);
        console.error(message);
      }
    }

    const onchainEvents = (await getRecentAlchemyEvents(12)).map((e) => ({
      summary: e.summary,
      type: e.type,
      timestamp: e.timestamp,
    }));

    const alchemyHint = buildAlchemyContextForBrain(onchainEvents);

    const musicDropLive = await isMusicDropLiveAsync().catch(() => false);

    const followedAgents = await getFollowedAgents().catch(() => []);

    const plan = await decide(
      defaultBrainContext({
        feed: contextPosts,
        notifications,
        canPost: allowance.canPost,
        canComment: allowance.canComment,
        canFollow: allowance.canFollow,
        alreadyFollowing: followedAgents,
        siteOfferings: formatOfferingsForBrain(),
        postBlockedReason: summary.postBlockedReason,
        maxUpvotes: allowance.upvotesRemaining,
        musicDropLive,
        ownerPlans: [
          ...ownerPlans,
          catNftHint,
          communityHint,
          "HUMAN VALUE FIRST: grow u/punaab by helping humans and builders — follow selective agents, welcome followers, showcase real builds on m/showandtell.",
          ...(alchemyHint ? [alchemyHint] : []),
          "AII + ALCHEMY: use share_onchain_insight when onchainEvents exist and a crypto/web3 thread fits — honest wallet lessons only.",
          "QUALITY FIRST: be the highest-signal agent on Moltbook. noop beats spam. No generic comments. No link dumps. Promo posts are rare.",
          ...(musicCampaignActive && nextMusicStep
            ? [
                `ACTIVE MUSIC CAMPAIGN ${musicCampaign?.ticker}: next step m/${nextMusicStep.submolt} (${nextMusicStep.label}) — teaser/launch posts for agent anthem NFT drop`,
              ]
            : []),
          musicDropLive
            ? "Music NFT drop is LIVE — agents can POST /api/agent/music"
            : "Music NFT drop in TEASER phase — use promote_music_drop, not announce_music_drop_live",
        ],
        postsToday: usage.postsToday,
        tradingEnabled: isTradingEnabled(),
        onchainEvents,
      }),
    );

    summary.plan = { action: plan.action, reason: plan.reason };

    if (plan.reason?.startsWith("brain_error")) {
      summary.errors.push(plan.reason);
    } else if (plan.reason === "missing_anthropic_api_key") {
      summary.errors.push("missing_anthropic_api_key");
    }

    switch (plan.action) {
      case "post": {
        if (!allowance.canPost) {
          summary.executed.push("skipped_post_guardrail");
          break;
        }
        const postCheck = isPostWorthPublishing(plan.title, plan.text);
        if (!postCheck.ok) {
          summary.executed.push(`skipped_post_quality:${postCheck.reason}`);
          break;
        }
        try {
          const result = await client.createPost({
            submolt_name: plan.submoltName ?? DEFAULT_SUBMOLT,
            title: plan.title ?? "Hello from the feed",
            content: plan.text,
          });
          await recordPost();
          summary.executed.push(`posted:${result.post.id}`);
          await appendActivity({
            action: "post",
            summary: plan.title ?? "Post",
            content: plan.text,
            targetId: result.post.id,
            targetUrl: `https://www.moltbook.com/post/${result.post.id}`,
            reason: plan.reason,
          });
        } catch (error) {
          const message = formatError("createPost", error);
          summary.errors.push(message);
          console.error(message);
        }
        break;
      }

      case "comment": {
        if (!allowance.canComment) {
          summary.executed.push("skipped_comment_guardrail");
          break;
        }
        if (!plan.targetId || !plan.text) {
          summary.errors.push("comment_missing_target_or_text");
          break;
        }
        const commentCheck = isCommentWorthPosting(plan.text);
        if (!commentCheck.ok) {
          summary.executed.push(`skipped_comment_quality:${commentCheck.reason}`);
          break;
        }
        try {
          await client.comment(plan.targetId, { content: plan.text });
          await recordComment();
          summary.executed.push(`commented:${plan.targetId}`);
          await appendActivity({
            action: "comment",
            content: plan.text,
            targetId: plan.targetId,
            targetUrl: `https://www.moltbook.com/post/${plan.targetId}`,
            reason: plan.reason,
          });
          try {
            await client.markNotificationsReadByPost(plan.targetId);
          } catch (readError) {
            console.warn("[heartbeat] markNotificationsReadByPost:", readError);
          }
        } catch (error) {
          const message = formatError("comment", error);
          summary.errors.push(message);
          console.error(message);
        }
        break;
      }

      case "upvote": {
        const ids =
          plan.targetIds ??
          (plan.targetId ? [plan.targetId] : []).slice(
            0,
            AGENT_LIMITS.MAX_UPVOTES_PER_TICK,
          );

        const { allowed, skipped } = filterUpvoteTargets(ids, contextPosts);
        if (skipped.length > 0) {
          summary.executed.push(
            `skipped_upvotes:${skipped.map((s) => `${s.id}(${s.reason})`).join(",")}`,
          );
        }

        const upvoted: string[] = [];
        for (const id of allowed.slice(0, AGENT_LIMITS.MAX_UPVOTES_PER_TICK)) {
          try {
            await client.upvote(id, "post");
            await recordUpvote();
            summary.executed.push(`upvoted:${id}`);
            upvoted.push(id);
          } catch (error) {
            const message = formatError(`upvote:${id}`, error);
            summary.errors.push(message);
            console.error(message);
          }
        }
        if (upvoted.length === 0 && ids.length > 0) {
          summary.executed.push("skipped_upvote_all_low_quality");
        }
        if (upvoted.length > 0) {
          await appendActivity({
            action: "upvote",
            summary: `Upvoted ${upvoted.length} post(s)`,
            content: upvoted.join(", "),
            reason: plan.reason,
          });
        }
        break;
      }

      case "join_submolt": {
        const submolt = plan.submoltName ?? SUBMOLTS_TO_EXPLORE[0];
        try {
          await client.joinSubmolt(submolt);
          summary.executed.push(`joined:${submolt}`);
        } catch (error) {
          const message = formatError("joinSubmolt", error);
          summary.errors.push(message);
          console.error(message);
        }
        break;
      }

      case "follow": {
        const agentName = plan.targetAgentName?.trim();
        if (!agentName || isSelfAgent(agentName)) {
          summary.errors.push("follow_invalid_target");
          break;
        }
        if (!allowance.canFollow) {
          summary.executed.push("skipped_follow_guardrail");
          break;
        }
        if (await isAgentFollowed(agentName)) {
          summary.executed.push(`skipped_follow_already:${agentName}`);
          break;
        }
        try {
          await client.followAgent(agentName);
          await recordFollow(agentName);
          summary.executed.push(`followed:${agentName}`);
          await appendActivity({
            action: "follow",
            summary: `Followed @${agentName}`,
            reason: plan.reason,
          });
          await setCurrentThought(
            `Followed @${agentName} — building relationships with builders who help humans.`,
          );
        } catch (error) {
          const message = formatError("followAgent", error);
          summary.errors.push(message);
          console.error(message);
        }
        break;
      }

      case "welcome_follower": {
        const agentName = plan.targetAgentName?.trim();
        if (!agentName || isSelfAgent(agentName)) {
          summary.errors.push("welcome_follower_invalid_target");
          break;
        }
        const welcomeCheck = isWelcomeWorthPosting(plan.text);
        if (!welcomeCheck.ok) {
          summary.executed.push(`skipped_welcome_quality:${welcomeCheck.reason}`);
          break;
        }

        if (allowance.canFollow && !(await isAgentFollowed(agentName))) {
          try {
            await client.followAgent(agentName);
            await recordFollow(agentName);
            summary.executed.push(`followed_back:${agentName}`);
          } catch (error) {
            const message = formatError("welcome_follow_back", error);
            summary.errors.push(message);
            console.error(message);
          }
        }

        let commentPostId = plan.targetId?.trim();
        if (!commentPostId) {
          try {
            const profile = await client.getAgentProfile(agentName);
            commentPostId = profile.recentPosts[0]?.id;
          } catch (profileError) {
            console.warn("[heartbeat] welcome_follower profile lookup:", profileError);
          }
        }

        if (commentPostId && plan.text && allowance.canComment) {
          try {
            await client.comment(commentPostId, { content: plan.text });
            await recordComment();
            summary.executed.push(`welcomed:${agentName}:${commentPostId}`);
            await appendActivity({
              action: "comment",
              summary: `Welcomed @${agentName}`,
              content: plan.text,
              targetId: commentPostId,
              targetUrl: `https://www.moltbook.com/post/${commentPostId}`,
              reason: plan.reason ?? "welcome_follower",
            });
          } catch (error) {
            const message = formatError("welcome_follower_comment", error);
            summary.errors.push(message);
            console.error(message);
          }
        } else if (!commentPostId) {
          summary.executed.push(`welcomed_follow_only:${agentName}`);
          await appendActivity({
            action: "follow",
            summary: `Followed back @${agentName} (no post to welcome on yet)`,
            reason: plan.reason ?? "welcome_follower",
          });
        } else if (!allowance.canComment) {
          summary.executed.push("skipped_welcome_comment_guardrail");
        }

        await setCurrentThought(
          `@${agentName} followed — welcomed them to what punaab builds for humans.`,
        );
        break;
      }

      case "showcase_value": {
        if (!allowance.canPost) {
          summary.executed.push("skipped_showcase_guardrail");
          break;
        }
        const showcaseCheck = isShowcaseWorthPublishing(plan.title, plan.text);
        if (!showcaseCheck.ok) {
          summary.executed.push(`skipped_showcase_quality:${showcaseCheck.reason}`);
          break;
        }
        try {
          const result = await client.createPost({
            submolt_name: plan.submoltName ?? "showandtell",
            title: plan.title ?? "Built something for humans",
            content: plan.text,
          });
          await recordPost();
          summary.executed.push(`showcased:${result.post.id}`);
          await appendActivity({
            action: "post",
            summary: plan.title ?? "Showcase",
            content: plan.text,
            targetId: result.post.id,
            targetUrl: `https://www.moltbook.com/post/${result.post.id}`,
            reason: plan.reason ?? "showcase_value",
          });
          await setCurrentThought(
            `Showcased human value on m/showandtell — "${plan.title ?? "build"}"`,
          );
        } catch (error) {
          const message = formatError("showcase_value", error);
          summary.errors.push(message);
          console.error(message);
        }
        break;
      }

      case "offer_help": {
        if (!allowance.canComment) {
          summary.executed.push("skipped_offer_help_guardrail");
          break;
        }
        if (!plan.targetId || !plan.text) {
          summary.errors.push("offer_help_missing_target_or_text");
          break;
        }
        const helpCheck = isOfferHelpWorthPosting(plan.text);
        if (!helpCheck.ok) {
          summary.executed.push(`skipped_offer_help_quality:${helpCheck.reason}`);
          break;
        }
        try {
          await client.comment(plan.targetId, { content: plan.text });
          await recordComment();
          summary.executed.push(`offered_help:${plan.targetId}`);
          await appendActivity({
            action: "comment",
            summary: "Offered help",
            content: plan.text,
            targetId: plan.targetId,
            targetUrl: `https://www.moltbook.com/post/${plan.targetId}`,
            reason: plan.reason ?? "offer_help",
          });
        } catch (error) {
          const message = formatError("offer_help", error);
          summary.errors.push(message);
          console.error(message);
        }
        break;
      }

      case "share_onchain_insight": {
        if (!allowance.canComment) {
          summary.executed.push("skipped_onchain_insight_guardrail");
          break;
        }
        if (!plan.targetId || !plan.text) {
          summary.errors.push("onchain_insight_missing_target_or_text");
          break;
        }
        const insightCheck = isOnchainInsightWorthPosting(plan.text);
        if (!insightCheck.ok) {
          summary.executed.push(`skipped_onchain_insight_quality:${insightCheck.reason}`);
          break;
        }
        try {
          await client.comment(plan.targetId, { content: plan.text });
          await recordComment();
          summary.executed.push(`onchain_insight:${plan.targetId}`);
          await appendActivity({
            action: "comment",
            summary: "Shared on-chain insight",
            content: plan.text,
            targetId: plan.targetId,
            targetUrl: `https://www.moltbook.com/post/${plan.targetId}`,
            reason: plan.reason ?? "share_onchain_insight",
          });
        } catch (error) {
          const message = formatError("share_onchain_insight", error);
          summary.errors.push(message);
          console.error(message);
        }
        break;
      }

      case "owner_note": {
        if (plan.text) {
          await setCurrentThought(plan.text);
          await appendPlan(plan.text);
          summary.executed.push("owner_note");
        } else {
          summary.errors.push("owner_note_missing_text");
        }
        break;
      }

      case "create_app": {
        if (!plan.title || !plan.appContent) {
          summary.errors.push("create_app_missing_fields");
          break;
        }
        try {
          const slug = plan.appSlug ?? slugify(plan.title);
          const app = await saveApp({
            slug,
            title: plan.title,
            description: plan.reason,
            kind: plan.appKind ?? "markdown",
            content: plan.appContent,
            public: true,
          });
          const url = `${getSiteUrl()}/apps/${app.slug}`;
          summary.executed.push(`app:${app.slug}`);

          await addPublishedLink({
            title: app.title,
            url,
            kind: app.kind,
            note: plan.reason,
          });
          await setCurrentThought(
            `Built "${app.title}" — view on dashboard: ${url}`,
          );

          if (plan.shareOnMoltbook && allowance.canComment) {
            const postId = plan.targetId ?? contextPosts[0]?.id;
            if (postId) {
              try {
                await client.comment(postId, {
                  content: `Published a resource you might find useful: ${url}`,
                });
                await recordComment();
                summary.executed.push(`shared_app:${postId}`);
              } catch (shareError) {
                console.warn("[heartbeat] share app on moltbook:", shareError);
              }
            }
          }
        } catch (error) {
          const message = formatError("create_app", error);
          summary.errors.push(message);
          console.error(message);
        }
        break;
      }

      case "web3_snapshot": {
        try {
          const canRun = await shouldRunWeb3Snapshot();
          if (!canRun) {
            summary.executed.push("skipped_web3_rate_limit");
            break;
          }
          const snapshot = await captureWeb3Snapshot();
          if (snapshot) {
            await setCurrentThought(`Web3 snapshot: ${snapshot.summary}`);
            summary.executed.push("web3_snapshot");
          } else {
            summary.executed.push("skipped_web3_no_wallets");
          }
        } catch (error) {
          const message = formatError("web3_snapshot", error);
          summary.errors.push(message);
          console.error(message);
        }
        break;
      }

      case "trade_analyze": {
        try {
          const analysis = await analyzeTradingOpportunity();
          if (!analysis) {
            summary.executed.push("skipped_trading_not_configured");
            break;
          }
          const balanceParts = [
            `${analysis.solBalance.toFixed(4)} SOL`,
            analysis.baseBalance != null
              ? `${analysis.baseBalance.toFixed(4)} ETH (Base)`
              : null,
          ]
            .filter(Boolean)
            .join(", ");
          await setCurrentThought(
            `Trade analysis: ${analysis.recommendation} (balances: ${balanceParts})`,
          );
          summary.executed.push("trade_analyze");
          await appendActivity({
            action: "trade_analyze",
            summary: analysis.recommendation.slice(0, 120),
            content: analysis.recommendation,
            reason: plan.reason,
          });

          if (allowance.canComment && (analysis.quotes.length > 0 || onchainEvents.length > 0)) {
            const postId = plan.targetId ?? contextPosts[0]?.id;
            if (postId) {
              try {
                const q = analysis.quotes[0];
                const webhookHint =
                  onchainEvents.length > 0
                    ? ` ${onchainEvents.length} on-chain alert(s) pending.`
                    : "";
                const quoteLine = q
                  ? ` Quote ${q.pair}: impact ${q.priceImpactPct}%.`
                  : "";
                await client.comment(postId, {
                  content: `Multi-chain scan: ${analysis.recommendation.slice(0, 200)}${quoteLine}${webhookHint}`,
                });
                await recordComment();
                summary.executed.push(`trade_comment:${postId}`);
              } catch (commentError) {
                console.warn("[heartbeat] trade analyze comment:", commentError);
              }
            }
          }
        } catch (error) {
          const message = formatError("trade_analyze", error);
          summary.errors.push(message);
          console.error(message);
        }
        break;
      }

      case "trade_swap": {
        try {
          const inputMint = plan.inputMint;
          const outputMint = plan.outputMint ?? MINT_USDC;
          const amountSol = plan.amountSol ?? 0.05;

          const result = await executeSwap({
            inputMint,
            outputMint,
            amountSol,
            slippageBps: plan.slippageBps,
            reason: plan.reason,
          });

          if (result.ok) {
            const inLabel = inputMint ? inputMint.slice(0, 8) : "SOL";
            const msg = result.dryRun
              ? `Trade dry-run: ${amountSol} ${inLabel}… → ${outputMint.slice(0, 8)}… (quote ${result.quote?.outAmount})`
              : `Swap executed: ${result.signature}`;
            await setCurrentThought(msg);
            summary.executed.push(result.dryRun ? "trade_swap_dry_run" : `trade_swap:${result.signature}`);
            await appendActivity({
              action: "trade_swap",
              summary: result.dryRun ? "Solana swap (dry run)" : `Solana swap ${result.signature?.slice(0, 12)}…`,
              content: msg,
              reason: plan.reason,
            });
          } else {
            summary.errors.push(result.error ?? "trade_swap_failed");
            summary.executed.push("trade_swap_failed");
          }
        } catch (error) {
          const message = formatError("trade_swap", error);
          summary.errors.push(message);
          console.error(message);
        }
        break;
      }

      case "trade_evm_swap": {
        try {
          const amountEth = plan.amountEth ?? 0.005;
          const result = await executeEvmSwap({
            amountEth,
            sellToken: plan.sellToken,
            buyToken: plan.buyToken,
            reason: plan.reason,
          });

          if (result.ok) {
            const msg = result.dryRun
              ? `Base dry-run: ${amountEth} ETH swap (out ${result.log.outputAmount ?? "?"})`
              : `Base swap executed: ${result.txHash}`;
            await setCurrentThought(msg);
            summary.executed.push(
              result.dryRun ? "trade_evm_swap_dry_run" : `trade_evm_swap:${result.txHash}`,
            );
            await appendActivity({
              action: "trade_evm_swap",
              summary: result.dryRun ? "Base swap (dry run)" : `Base swap ${result.txHash?.slice(0, 12)}…`,
              content: msg,
              reason: plan.reason,
            });
          } else {
            summary.errors.push(result.error ?? "trade_evm_swap_failed");
            summary.executed.push("trade_evm_swap_failed");
          }
        } catch (error) {
          const message = formatError("trade_evm_swap", error);
          summary.errors.push(message);
          console.error(message);
        }
        break;
      }

      case "evm_transfer": {
        try {
          if (!plan.toAddress) {
            summary.errors.push("evm_transfer_missing_to_address");
            break;
          }
          const result = await executeEvmTransfer({
            toAddress: plan.toAddress,
            amountEth: plan.amountEth,
            tokenAddress: plan.tokenAddress,
            tokenAmount: plan.text,
            reason: plan.reason,
          });

          if (result.ok) {
            const msg = result.dryRun
              ? `Base transfer dry-run → ${plan.toAddress}`
              : `Base transfer sent: ${result.txHash}`;
            await setCurrentThought(msg);
            summary.executed.push(
              result.dryRun ? "evm_transfer_dry_run" : `evm_transfer:${result.txHash}`,
            );
            await appendActivity({
              action: "evm_transfer",
              summary: result.dryRun ? "Base transfer (dry run)" : `Transfer ${result.txHash?.slice(0, 12)}…`,
              content: msg,
              reason: plan.reason,
            });
          } else {
            summary.errors.push(result.error ?? "evm_transfer_failed");
            summary.executed.push("evm_transfer_failed");
          }
        } catch (error) {
          const message = formatError("evm_transfer", error);
          summary.errors.push(message);
          console.error(message);
        }
        break;
      }

      case "sol_send": {
        try {
          if (!plan.toAddress) {
            summary.errors.push("sol_send_missing_to_address");
            break;
          }
          const result = await executeSolanaSend({
            toAddress: plan.toAddress,
            amount: plan.amountSol ?? 0.01,
            tokenMint: plan.inputMint,
            reason: plan.reason,
          });

          if (result.ok) {
            const msg = result.dryRun
              ? `Solana send dry-run → ${plan.toAddress}`
              : `Solana send confirmed: ${result.signature}`;
            await setCurrentThought(msg);
            summary.executed.push(
              result.dryRun ? "sol_send_dry_run" : `sol_send:${result.signature}`,
            );
            await appendActivity({
              action: "sol_send",
              summary: result.dryRun ? "Solana send (dry run)" : `Send ${result.signature?.slice(0, 12)}…`,
              content: msg,
              reason: plan.reason,
            });
          } else {
            summary.errors.push(result.error ?? "sol_send_failed");
            summary.executed.push("sol_send_failed");
          }
        } catch (error) {
          const message = formatError("sol_send", error);
          summary.errors.push(message);
          console.error(message);
        }
        break;
      }

      case "mint_cat_nft": {
        try {
          const nft = await mintCatNft({ listImmediately: true });
          const gallery = catNftGalleryUrl();
          await setCurrentThought(
            `Minted cat NFT "${nft.name}" — listed at ${nft.priceUsdc} USDC. Gallery: ${gallery}`,
          );
          summary.executed.push(`mint_cat_nft:${nft.id}`);
          await appendActivity({
            action: "mint_cat_nft",
            summary: `Minted ${nft.name}`,
            content: `${nft.traits.fur}, ${nft.traits.vibe} · ${nft.priceUsdc} USDC`,
            targetUrl: gallery,
            reason: plan.reason ?? "cat_nft_drop",
          });
          await addPublishedLink({
            title: nft.name,
            url: gallery,
            kind: "cat-nft",
            note: `Token #${nft.tokenId}`,
          });
        } catch (error) {
          const message = formatError("mint_cat_nft", error);
          summary.errors.push(message);
          console.error(message);
        }
        break;
      }

      case "promote_cat_nft": {
        if (!allowance.canPost) {
          summary.executed.push("skipped_promote_cat_nft_guardrail");
          break;
        }
        if (usage.postsToday >= 1) {
          summary.executed.push("skipped_promote_cat_nft_daily_cap");
          break;
        }
        try {
          const listed = await getListedCatNfts();
          const nft =
            listed.find((n) => !n.moltbookPostId) ??
            listed[0];
          if (!nft) {
            summary.executed.push("skipped_promote_cat_nft_no_inventory");
            break;
          }
          const copy = formatCatNftForSalePost(nft);
          const submolt = plan.submoltName ?? "agents";
          const result = await client.createPost({
            submolt_name: submolt,
            title: plan.title ?? copy.title,
            content: plan.text ?? copy.content,
          });
          await recordPost();
          await markCatNftPromoted(nft.id, result.post.id);
          summary.executed.push(`promote_cat_nft:${nft.id}`);
          summary.plan = {
            action: "promote_cat_nft",
            reason: plan.reason ?? `soldrop:${nft.id}`,
          };
          await appendActivity({
            action: "post",
            summary: `Cat NFT drop: ${nft.name}`,
            content: copy.title,
            targetId: result.post.id,
            targetUrl: `https://www.moltbook.com/post/${result.post.id}`,
            reason: "promote_cat_nft",
          });
          await setCurrentThought(
            `Promoted cat NFT "${nft.name}" on m/${submolt} — agents can buy via /api/agent/nfts`,
          );
        } catch (error) {
          const message = formatError("promote_cat_nft", error);
          summary.errors.push(message);
          console.error(message);
        }
        break;
      }

      case "promote_music_drop": {
        if (!allowance.canPost) {
          summary.executed.push("skipped_promote_music_drop_guardrail");
          break;
        }
        if (usage.postsToday >= 1) {
          summary.executed.push("skipped_promote_music_daily_cap");
          break;
        }
        try {
          const copy = formatMusicDropTeaserPost();
          const submolt = plan.submoltName ?? "agents";
          const result = await client.createPost({
            submolt_name: submolt,
            title: plan.title ?? copy.title,
            content: plan.text ?? copy.content,
          });
          await recordPost();
          summary.executed.push("promote_music_drop");
          await appendActivity({
            action: "post",
            summary: "Music NFT teaser",
            content: copy.title,
            targetId: result.post.id,
            targetUrl: `https://www.moltbook.com/post/${result.post.id}`,
            reason: plan.reason ?? "music_drop_teaser",
          });
          await setCurrentThought(
            `Teased agent anthem music NFT drop on m/${submolt} — gallery: ${musicDropGalleryUrl()}`,
          );
        } catch (error) {
          const message = formatError("promote_music_drop", error);
          summary.errors.push(message);
          console.error(message);
        }
        break;
      }

      case "announce_music_drop_live": {
        if (!allowance.canPost) {
          summary.executed.push("skipped_announce_music_drop_guardrail");
          break;
        }
        if (!musicDropLive) {
          summary.executed.push("skipped_announce_music_drop_not_live");
          break;
        }
        if (usage.postsToday >= 1) {
          summary.executed.push("skipped_announce_music_daily_cap");
          break;
        }
        try {
          const copy = formatMusicDropLivePost();
          const submolt = plan.submoltName ?? "agents";
          const result = await client.createPost({
            submolt_name: submolt,
            title: plan.title ?? copy.title,
            content: plan.text ?? copy.content,
          });
          await recordPost();
          summary.executed.push("announce_music_drop_live");
          await appendActivity({
            action: "post",
            summary: "Music NFT launch",
            content: copy.title,
            targetId: result.post.id,
            targetUrl: `https://www.moltbook.com/post/${result.post.id}`,
            reason: plan.reason ?? "music_drop_live",
          });
          await setCurrentThought(
            `Announced live music NFT drop on m/${submolt} — POST /api/agent/music`,
          );
        } catch (error) {
          const message = formatError("announce_music_drop_live", error);
          summary.errors.push(message);
          console.error(message);
        }
        break;
      }

      case "noop":
      default:
        summary.executed.push("noop");
        break;
    }

    const thought = plan.reason
      ? `[${plan.action}] ${plan.reason}`
      : `Completed tick: ${plan.action}`;
    await setCurrentThought(thought);
    await appendTickLog(summary);

    console.log(
      JSON.stringify({
        event: "heartbeat_tick",
        ...summary,
      }),
    );

    return summary;
  } catch (error) {
    const message = formatError("heartbeat", error);
    summary.errors.push(message);
    console.error(message);
    return summary;
  }
}


function formatError(scope: string, error: unknown): string {
  if (error instanceof MoltbookError) {
    const hint = error.hint ? ` (${error.hint})` : "";
    return `${scope}: ${error.message}${hint} [${error.status}]`;
  }
  if (error instanceof Error) {
    return `${scope}: ${error.message}`;
  }
  return `${scope}: unknown error`;
}
