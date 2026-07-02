import { decide, defaultBrainContext } from "@/lib/brain";
import { AGENT_LIMITS, getCronSecret } from "@/lib/config";
import {
  canPostNow,
  getSeenPostIds,
  incrementPostsThisHour,
  recordSeenPostIds,
  setLastPostAt,
} from "@/lib/memory";
import {
  MoltbookClient,
  MoltbookError,
  type MoltbookNotification,
  type MoltbookPost,
} from "@/lib/moltbook";
import { DEFAULT_SUBMOLT, SUBMOLTS_TO_EXPLORE } from "@/lib/persona";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TickSummary {
  ok: boolean;
  timestamp: string;
  feedCount: number;
  newPostCount: number;
  notificationCount: number;
  canPost: boolean;
  postBlockedReason?: string;
  plan: { action: string; reason?: string };
  executed: string[];
  errors: string[];
}

function getPostId(post: MoltbookPost): string | null {
  const id = post.id?.trim();
  return id ? id : null;
}

function authorize(request: NextRequest): boolean {
  const secret = getCronSecret();
  if (!secret) {
    console.error("[heartbeat] CRON_SECRET is not configured");
    return false;
  }

  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  return auth.slice("Bearer ".length) === secret;
}

export async function GET(request: NextRequest): Promise<NextResponse<TickSummary>> {
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

  if (!authorize(request)) {
    return NextResponse.json(
      {
        ...summary,
        ok: false,
        errors: ["unauthorized"],
        plan: { action: "noop", reason: "unauthorized" },
      },
      { status: 401 },
    );
  }

  const client = new MoltbookClient();

  try {
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

    const postCheck = await canPostNow(
      AGENT_LIMITS.MAX_POSTS_PER_HOUR,
      AGENT_LIMITS.MIN_POST_INTERVAL_MS,
    );
    summary.canPost = postCheck.allowed;
    summary.postBlockedReason = postCheck.reason;

    const contextPosts =
      unseenPosts.length > 0 ? unseenPosts : feedPosts;

    const plan = await decide(
      defaultBrainContext({
        feed: contextPosts,
        notifications,
        canPost: postCheck.allowed,
        postBlockedReason: postCheck.reason,
        maxUpvotes: AGENT_LIMITS.MAX_UPVOTES_PER_TICK,
      }),
    );

    summary.plan = { action: plan.action, reason: plan.reason };

    switch (plan.action) {
      case "post": {
        if (!postCheck.allowed) {
          summary.executed.push("skipped_post_guardrail");
          break;
        }
        try {
          const result = await client.createPost({
            submolt_name: plan.submoltName ?? DEFAULT_SUBMOLT,
            title: plan.title ?? "Hello from the feed",
            content: plan.text,
          });
          await setLastPostAt(Date.now());
          await incrementPostsThisHour();
          summary.executed.push(`posted:${result.post.id}`);
        } catch (error) {
          const message = formatError("createPost", error);
          summary.errors.push(message);
          console.error(message);
        }
        break;
      }

      case "comment": {
        if (!plan.targetId || !plan.text) {
          summary.errors.push("comment_missing_target_or_text");
          break;
        }
        try {
          await client.comment(plan.targetId, { content: plan.text });
          summary.executed.push(`commented:${plan.targetId}`);
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

        for (const id of ids.slice(0, AGENT_LIMITS.MAX_UPVOTES_PER_TICK)) {
          try {
            await client.upvote(id, "post");
            summary.executed.push(`upvoted:${id}`);
          } catch (error) {
            const message = formatError(`upvote:${id}`, error);
            summary.errors.push(message);
            console.error(message);
          }
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

      case "noop":
      default:
        summary.executed.push("noop");
        break;
    }

    console.log(
      JSON.stringify({
        event: "heartbeat_tick",
        ...summary,
      }),
    );

    return NextResponse.json(summary, { status: 200 });
  } catch (error) {
    const message = formatError("heartbeat", error);
    summary.errors.push(message);
    console.error(message);
    return NextResponse.json(summary, { status: 200 });
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
