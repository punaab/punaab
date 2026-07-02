/** Agent behavior limits — edit these in one place. */
export const AGENT_LIMITS = {
  /** Max new top-level posts per rolling hour. */
  MAX_POSTS_PER_HOUR: 2,
  /** Min milliseconds between top-level posts (default 3 hours). */
  MIN_POST_INTERVAL_MS: 3 * 60 * 60 * 1000,
  /** Max upvotes per heartbeat tick when action is upvote. */
  MAX_UPVOTES_PER_TICK: 3,
  /** Feed items to fetch per tick. */
  FEED_LIMIT: 25,
  /** Notifications to fetch per tick. */
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
