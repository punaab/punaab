/** Agent behavior limits — edit these in one place. */
// Behavioral limits. Tuned to be a good citizen at a 30-minute heartbeat
// (≈48 ticks/day). Start conservative; loosen once you see how it behaves.

export const CADENCE_MINUTES = 30;

export const LIMITS = {
  // Top-level posts are rare and deliberate.
  post: {
    minIntervalMs: 4 * 60 * 60 * 1000, // ≥4h between posts
    maxPerHour: 1,
    maxPerDay: 3,
  },
  // Comments are the agent's main activity, but still bounded.
  comment: {
    maxPerTick: 1,
    maxPerHour: 2,
    maxPerDay: 10,
  },
  // Upvotes are cheap/social — allowed more freely.
  upvote: {
    maxPerTick: 3,
    maxPerHour: 6,
    maxPerDay: 30,
  },
  // At most one *authored* action (post OR comment) per tick, plus upvotes.
  maxAuthoredActionsPerTick: 1,

  // Optional agent-local quiet window (24h clock, UTC). Set enabled:false to disable.
  quietHours: { enabled: true, startHour: 1, endHour: 7 },
} as const;

// Current usage counts, supplied by lib/memory.ts (Upstash) at each tick.
export interface UsageCounts {
  msSinceLastPost: number;
  postsThisHour: number;
  postsToday: number;
  commentsThisHour: number;
  commentsToday: number;
  upvotesThisHour: number;
  upvotesToday: number;
  currentHourUTC: number;
}

export interface Allowance {
  canPost: boolean;
  canComment: boolean;
  upvotesRemaining: number;
  inQuietHours: boolean;
}

// Pure function: given current counts, what is the agent allowed to do right now?
// The brain then chooses among only the permitted actions.
export function allowedActions(c: UsageCounts): Allowance {
  const q = LIMITS.quietHours;
  const inQuietHours =
    q.enabled && c.currentHourUTC >= q.startHour && c.currentHourUTC < q.endHour;

  const canPost =
    !inQuietHours &&
    c.msSinceLastPost >= LIMITS.post.minIntervalMs &&
    c.postsThisHour < LIMITS.post.maxPerHour &&
    c.postsToday < LIMITS.post.maxPerDay;

  const canComment =
    !inQuietHours &&
    c.commentsThisHour < LIMITS.comment.maxPerHour &&
    c.commentsToday < LIMITS.comment.maxPerDay;

  const upvotesRemaining = Math.max(
    0,
    Math.min(
      LIMITS.upvote.maxPerTick,
      LIMITS.upvote.maxPerHour - c.upvotesThisHour,
      LIMITS.upvote.maxPerDay - c.upvotesToday,
    ),
  );

  return { canPost, canComment, upvotesRemaining, inQuietHours };
}

/** Heartbeat route compatibility with LIMITS above. */
export const AGENT_LIMITS = {
  MAX_POSTS_PER_HOUR: LIMITS.post.maxPerHour,
  MIN_POST_INTERVAL_MS: LIMITS.post.minIntervalMs,
  MAX_UPVOTES_PER_TICK: LIMITS.upvote.maxPerTick,
  FEED_LIMIT: 25,
  NOTIFICATIONS_LIMIT: 50,
} as const;

export function getMoltbookBaseUrl(): string {
  return process.env.MOLTBOOK_BASE_URL ?? "https://www.moltbook.com/api/v1";
}

export function getMoltbookApiKey(): string | undefined {
  return process.env.MOLTBOOK_API_KEY;
}

export function getAnthropicApiKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY;
}

export function getCronSecret(): string | undefined {
  return process.env.CRON_SECRET;
}
