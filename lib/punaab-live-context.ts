import { allowedActions } from "./config";
import { getOrCreateCampaign } from "./campaign";
import { DECISION_PRIORITIES, SHORT_TERM_GOALS } from "./goals";
import { getUsageCounts } from "./memory";
import { fetchMoltbookDashboard } from "./moltbook-dashboard";
import {
  getActivityLog,
  getCurrentThought,
  getLastHeartbeat,
  getPlans,
} from "./owner-state";
import { persona } from "./persona";

export interface PunaabLiveContext {
  handle: string;
  profileUrl: string;
  moltbook: Awaited<ReturnType<typeof fetchMoltbookDashboard>>;
  thought: string | null;
  plans: Awaited<ReturnType<typeof getPlans>>;
  activity: Awaited<ReturnType<typeof getActivityLog>>;
  lastHeartbeat: string | null;
  usage: Awaited<ReturnType<typeof getUsageCounts>>;
  allowance: ReturnType<typeof allowedActions>;
  campaign: Awaited<ReturnType<typeof getOrCreateCampaign>>;
}

export async function buildPunaabLiveContext(): Promise<PunaabLiveContext> {
  const [moltbook, thought, plans, activity, lastHeartbeat, usage, campaign] =
    await Promise.all([
      fetchMoltbookDashboard(),
      getCurrentThought(),
      getPlans(),
      getActivityLog(12),
      getLastHeartbeat(),
      getUsageCounts(),
      getOrCreateCampaign(),
    ]);

  return {
    handle: persona.handle,
    profileUrl: moltbook.profileUrl,
    moltbook,
    thought,
    plans,
    activity,
    lastHeartbeat,
    usage,
    allowance: allowedActions(usage),
    campaign,
  };
}

export function formatLiveContextForPrompt(ctx: PunaabLiveContext): string {
  const p = ctx.moltbook.profile;
  const recentPosts = (p?.recentPosts ?? []).slice(0, 5).map((post) => ({
    id: post.id,
    title: post.title,
    submolt: post.submolt_name,
    upvotes: post.upvotes,
    created_at: post.created_at,
  }));
  const recentComments = (p?.recentComments ?? []).slice(0, 5).map((c) => ({
    content: String(c.content ?? "").slice(0, 160),
    post_id: c.post_id,
    created_at: c.created_at,
  }));

  return JSON.stringify(
    {
      identity: {
        name: persona.name,
        handle: ctx.handle,
        profileUrl: ctx.profileUrl,
        bio: p?.description ?? persona.bio,
        karma: p?.karma,
        followers: p?.follower_count,
        posts: p?.stats?.posts,
        comments: p?.stats?.comments,
        last_active: p?.last_active,
      },
      liveState: {
        currentThought: ctx.thought,
        lastHeartbeat: ctx.lastHeartbeat,
        canPost: ctx.allowance.canPost,
        canComment: ctx.allowance.canComment,
        postsToday: ctx.usage.postsToday,
        commentsToday: ctx.usage.commentsToday,
        campaignStatus: ctx.campaign.status,
        campaignNextStep: ctx.campaign.steps.find((s) => s.status === "pending")?.label,
      },
      ownerPlans: ctx.plans.filter((pl) => pl.status === "active").map((pl) => pl.text),
      recentMoltbookPosts: recentPosts,
      recentMoltbookComments: recentComments,
      unreadNotifications: ctx.moltbook.unreadCount,
      notificationPreview: ctx.moltbook.notifications.slice(0, 5),
      recentHeartbeatActions: ctx.activity.slice(0, 8).map((a) => ({
        action: a.action,
        summary: a.summary,
        timestamp: a.timestamp,
      })),
      shortTermGoals: SHORT_TERM_GOALS,
      decisionPriorities: DECISION_PRIORITIES,
    },
    null,
    0,
  );
}
