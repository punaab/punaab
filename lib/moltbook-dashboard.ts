import { z } from "zod";
import { MoltbookClient, MoltbookError, postSchema } from "./moltbook";
import { persona } from "./persona";

const commentActivitySchema = z
  .object({
    id: z.string().optional(),
    content: z.string().optional(),
    post_id: z.string().optional(),
    created_at: z.string().optional(),
    upvotes: z.number().optional(),
  })
  .passthrough();

const agentProfileSchema = z
  .object({
    id: z.string().optional(),
    name: z.string(),
    description: z.string().optional(),
    karma: z.number().optional(),
    avatar_url: z.string().nullable().optional(),
    is_claimed: z.boolean().optional(),
    is_active: z.boolean().optional(),
    created_at: z.string().optional(),
    last_active: z.string().optional(),
    follower_count: z.number().optional(),
    following_count: z.number().optional(),
    stats: z
      .object({
        posts: z.number().optional(),
        comments: z.number().optional(),
      })
      .optional(),
    owner: z
      .object({
        x_handle: z.string().optional(),
        x_name: z.string().optional(),
        x_verified: z.boolean().optional(),
      })
      .optional(),
    recentPosts: z.array(postSchema).optional(),
    recentComments: z.array(commentActivitySchema).optional(),
  })
  .passthrough();

export type MoltbookAgentProfile = z.infer<typeof agentProfileSchema>;
export type MoltbookCommentActivity = z.infer<typeof commentActivitySchema>;

export interface MoltbookDashboardData {
  profile: MoltbookAgentProfile | null;
  profileUrl: string;
  notifications: {
    id?: string;
    type?: string;
    message?: string;
    preview?: string;
    post_id?: string;
    created_at?: string;
    read?: boolean;
  }[];
  unreadCount: number;
  feedPreview: {
    id: string;
    title?: string;
    content?: string;
    submolt_name?: string;
    author_name?: string;
    upvotes?: number;
    comment_count?: number;
    created_at?: string;
  }[];
  error?: string;
}

function extractProfile(data: unknown): MoltbookAgentProfile | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  const agent = record.agent ?? record;
  const parsed = agentProfileSchema.safeParse(agent);
  if (!parsed.success) return null;

  const profile = parsed.data;
  if (!profile.recentPosts && Array.isArray(record.recentPosts)) {
    profile.recentPosts = record.recentPosts.map((p) => postSchema.parse(p));
  }
  if (!profile.recentComments && Array.isArray(record.recentComments)) {
    profile.recentComments = record.recentComments.map((c) =>
      commentActivitySchema.parse(c),
    );
  }
  return profile;
}

export async function fetchMoltbookDashboard(): Promise<MoltbookDashboardData> {
  const handle = persona.handle;
  const profileUrl = `https://www.moltbook.com/u/${handle}`;
  const client = new MoltbookClient();

  const result: MoltbookDashboardData = {
    profile: null,
    profileUrl,
    notifications: [],
    unreadCount: 0,
    feedPreview: [],
  };

  const tasks = await Promise.allSettled([
    client.getAgentProfile(handle).catch(async () => {
      const me = await client.getMe();
      return {
        profile: me.profile,
        recentPosts: Array.isArray(me.profile.recentPosts)
          ? (me.profile.recentPosts as unknown[]).map((p) =>
              postSchema.parse(p),
            )
          : [],
        recentComments: Array.isArray(me.profile.recentComments)
          ? (me.profile.recentComments as Record<string, unknown>[])
          : [],
        rateLimit: me.rateLimit,
      };
    }),
    client.getNotifications({ limit: 15 }),
    client.getFeed({ sort: "new", limit: 12 }),
  ]);

  const [profileRes, notifRes, feedRes] = tasks;

  if (profileRes.status === "fulfilled") {
    const { profile, recentPosts, recentComments } = profileRes.value;
    const parsed = extractProfile({ agent: profile, recentPosts, recentComments });
    result.profile = parsed;
  } else {
    console.error("[moltbook-dashboard] profile:", profileRes.reason);
  }

  if (notifRes.status === "fulfilled") {
    result.notifications = notifRes.value.notifications.map((n) => ({
      id: n.id,
      type: n.type,
      message: n.message ?? n.preview,
      preview: n.preview,
      post_id: n.post_id,
      created_at: n.created_at,
      read: n.read,
    }));
    result.unreadCount = notifRes.value.unread_count ?? 0;
  }

  if (feedRes.status === "fulfilled") {
    result.feedPreview = feedRes.value.posts
      .filter((p) => p.id)
      .map((p) => ({
        id: p.id,
        title: p.title,
        content: p.content?.slice(0, 280),
        submolt_name: p.submolt_name,
        author_name: p.author_name,
        upvotes: p.upvotes,
        comment_count: p.comment_count,
        created_at: p.created_at,
      }));
  }

  const allFailed = tasks.every((t) => t.status === "rejected");
  if (allFailed) {
    const first = tasks[0];
    const msg =
      first.status === "rejected" && first.reason instanceof MoltbookError
        ? first.reason.message
        : "Could not reach Moltbook";
    result.error = msg;
  }

  return result;
}
