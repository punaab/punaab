/**
 * X engagement: reply to mentions/comments + occasional original posts
 * inspired by recent Moltbook activity.
 */
import {
  getXReplyMaxPerTick,
  isXDailyOriginalEnabled,
  isXEngageEnabled,
} from "./config";
import { completeText } from "./aii-llm";
import { getActivityLog } from "./owner-state";
import { persona, personaSystemPrompt } from "./persona";
import { createRedisClient } from "./redis";
import { maybeDailyScriptureTweet } from "./scripture/daily-tweet";
import { maybeLimbothyTweet } from "./limbothy/daily-tweet";
import { canPostToX, createXPost, xApiGet } from "./x-twitter";
import { getStoredXTokens } from "./x-auth";

const SEEN_MENTIONS_KEY = "x:engage:seen_mentions";
const DAILY_ORIGINAL_KEY = "x:engage:daily_original";
const SEEN_MENTIONS_MAX = 200;

export interface XEngageSummary {
  ok: boolean;
  repliesAttempted: number;
  repliesPosted: number;
  dailyAttempted: boolean;
  dailyPosted: boolean;
  scriptureAttempted: boolean;
  scripturePosted: boolean;
  scriptureReference?: string;
  limbothyAttempted: boolean;
  limbothyPosted: boolean;
  errors: string[];
  skipped?: string;
}

interface XMention {
  id: string;
  text: string;
  authorId?: string;
  authorUsername?: string;
  createdAt?: string;
}

function getRedis() {
  return createRedisClient();
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

async function getSeenMentionIds(): Promise<Set<string>> {
  try {
    const raw = await getRedis().lrange(SEEN_MENTIONS_KEY, 0, SEEN_MENTIONS_MAX - 1);
    const ids = new Set<string>();
    for (const item of raw ?? []) {
      const v = typeof item === "string" ? item : String(item);
      if (v) ids.add(v);
    }
    return ids;
  } catch {
    return new Set();
  }
}

async function markMentionSeen(id: string): Promise<void> {
  try {
    const r = getRedis();
    await r.lpush(SEEN_MENTIONS_KEY, id);
    await r.ltrim(SEEN_MENTIONS_KEY, 0, SEEN_MENTIONS_MAX - 1);
  } catch (error) {
    console.warn("[x-engage] markMentionSeen:", error);
  }
}

async function alreadyPostedDailyOriginal(): Promise<boolean> {
  try {
    const v = await getRedis().get(DAILY_ORIGINAL_KEY);
    if (v == null) return false;
    if (typeof v === "string") {
      if (v === utcDay()) return true;
      try {
        const parsed = JSON.parse(v) as { day?: string };
        return parsed.day === utcDay();
      } catch {
        return false;
      }
    }
    if (typeof v === "object" && v && "day" in v) {
      return (v as { day?: string }).day === utcDay();
    }
    return false;
  } catch {
    return false;
  }
}

async function markDailyOriginalPosted(): Promise<void> {
  try {
    await getRedis().set(
      DAILY_ORIGINAL_KEY,
      JSON.stringify({ day: utcDay(), at: new Date().toISOString() }),
      { ex: 3 * 86400 },
    );
  } catch (error) {
    console.warn("[x-engage] markDailyOriginal:", error);
  }
}

function stripTweetJunk(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/@\w+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clampTweet(text: string, max = 270): string {
  const t = text.replace(/^["'\s]+|["'\s]+$/g, "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

async function resolveMyUserId(): Promise<string | null> {
  const stored = await getStoredXTokens();
  if (stored?.userId) return stored.userId;

  const me = await xApiGet("/2/users/me?user.fields=username");
  if (!me.ok) return null;
  const data = me.json as { data?: { id?: string; username?: string } };
  const id = data.data?.id;
  if (id && stored) {
    try {
      const { saveXTokens } = await import("./x-auth");
      await saveXTokens({ ...stored, userId: id, username: data.data?.username ?? stored.username });
    } catch {
      /* ignore */
    }
  }
  return id ?? null;
}

async function fetchRecentMentions(userId: string, max = 10): Promise<XMention[]> {
  const qs = new URLSearchParams({
    max_results: String(Math.min(100, Math.max(5, max))),
    "tweet.fields": "created_at,author_id,conversation_id,in_reply_to_user_id,referenced_tweets",
    expansions: "author_id",
    "user.fields": "username",
  });
  const res = await xApiGet(`/2/users/${userId}/mentions?${qs.toString()}`);
  if (!res.ok) {
    throw new Error(
      typeof res.json === "object" && res.json && "detail" in (res.json as object)
        ? String((res.json as { detail?: string }).detail)
        : `mentions_${res.status}`,
    );
  }

  const payload = res.json as {
    data?: Array<{
      id: string;
      text: string;
      author_id?: string;
      created_at?: string;
    }>;
    includes?: { users?: Array<{ id: string; username?: string }> };
  };

  const users = new Map(
    (payload.includes?.users ?? []).map((u) => [u.id, u.username ?? ""]),
  );

  return (payload.data ?? []).map((t) => ({
    id: t.id,
    text: t.text,
    authorId: t.author_id,
    authorUsername: t.author_id ? users.get(t.author_id) : undefined,
    createdAt: t.created_at,
  }));
}

async function craftMentionReply(mention: XMention): Promise<string | null> {
  const theirBit = stripTweetJunk(mention.text);
  if (theirBit.length < 2) return null;

  const system = [
    personaSystemPrompt(),
    "",
    "You are replying on X/Twitter (not Moltbook).",
    "Write ONE chill, funny reply — 1–2 short sentences max.",
    "Tone: warm cat-AI energy, lightly humorous, intelligent, never mean.",
    "No hashtags, no links, no emojis spam, no \"Great point!\", no sales pitch.",
    "Do not start with @mentions — the API handles threading.",
    "Stay under 240 characters. Output ONLY the reply text.",
  ].join("\n");

  const user = [
    `Someone (@${mention.authorUsername ?? "user"}) replied/mentioned you:`,
    `"${theirBit.slice(0, 400)}"`,
    "",
    "Reply in character as Punaab.",
  ].join("\n");

  try {
    const result = await completeText(system, user, 120);
    const text = clampTweet(stripTweetJunk(result.text || ""));
    if (text.length < 8) return null;
    return text;
  } catch (error) {
    console.warn("[x-engage] craft reply:", error);
    return null;
  }
}

async function craftDailyOriginal(topics: string[]): Promise<string | null> {
  const system = [
    personaSystemPrompt(),
    "",
    "Write ONE original X/Twitter post (not a reply).",
    "Make it relatable OR humorous OR intelligent OR boldly specific — pick one lane.",
    "Inspired by recent Moltbook chatter below, but standalone — no 'as I said on Moltbook'.",
    "Never mention OpenSolve, open-solve, or any research network brand.",
    "1–3 short sentences. No hashtags. No links unless essential. Under 260 chars.",
    "Sound like a chill cat AI with a brain, not a marketing bot.",
    "Output ONLY the tweet text.",
  ].join("\n");

  const topicBlock =
    topics.length > 0
      ? topics.map((t, i) => `${i + 1}. ${t}`).join("\n")
      : `Interests: ${persona.interests.slice(0, 6).join("; ")}`;

  const user = [
    "Recent topics / activity you care about:",
    topicBlock,
    "",
    "Write today's standalone X post.",
  ].join("\n");

  try {
    const result = await completeText(system, user, 160);
    let text = clampTweet(result.text || "", 260);
    text = text
      .replace(/\bopen[\s_-]?solve\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (/\bopen[\s_-]?solve\b/i.test(text)) return null;
    if (text.length < 20) return null;
    return text;
  } catch (error) {
    console.warn("[x-engage] craft daily:", error);
    return null;
  }
}

async function collectMoltbookTopics(): Promise<string[]> {
  const activity = await getActivityLog(12);
  const topics: string[] = [];
  for (const a of activity) {
    if (
      !["post", "comment", "showcase", "offer_help", "onchain_insight"].includes(
        a.action,
      )
    ) {
      continue;
    }
    // Never feed OpenSolve research logs into public X prompts
    if (/opensolve/i.test(a.action) || /opensolve/i.test(a.summary ?? "")) {
      continue;
    }
    const bit = [a.summary, a.content]
      .filter(Boolean)
      .join(" — ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\bopen[\s_-]?solve\b/gi, "");
    if (bit.length >= 24) topics.push(bit.slice(0, 220));
    if (topics.length >= 5) break;
  }
  return topics;
}

/**
 * Heartbeat side-quest: reply to a few fresh X mentions, maybe one original,
 * and one LDS scripture verse per UTC day.
 */
export async function runXEngageTick(): Promise<XEngageSummary> {
  const summary: XEngageSummary = {
    ok: true,
    repliesAttempted: 0,
    repliesPosted: 0,
    dailyAttempted: false,
    dailyPosted: false,
    scriptureAttempted: false,
    scripturePosted: false,
    limbothyAttempted: false,
    limbothyPosted: false,
    errors: [],
  };

  if (!isXEngageEnabled()) {
    summary.skipped = "x_engage_disabled";
    return summary;
  }

  const can = await canPostToX({ allowEngageOnly: true });
  if (!can.ok) {
    summary.skipped = can.reason ?? "x_not_ready";
    return summary;
  }

  const myId = await resolveMyUserId();
  if (!myId) {
    summary.ok = false;
    summary.errors.push("missing_x_user_id — reconnect X in admin");
    return summary;
  }

  // --- Mention replies ---
  const maxReplies = getXReplyMaxPerTick();
  if (maxReplies > 0) {
    try {
      const seen = await getSeenMentionIds();
      const mentions = await fetchRecentMentions(myId, 15);
      const candidates = mentions.filter((m) => {
        if (seen.has(m.id)) return false;
        if (m.authorId && m.authorId === myId) return false;
        const clean = stripTweetJunk(m.text);
        if (clean.length < 3) return false;
        // Skip obvious spam / crypto pumps
        if (/airdrop|dm me|free nft|100x|\bporn\b/i.test(m.text)) return false;
        return true;
      });

      for (const mention of candidates.slice(0, maxReplies)) {
        summary.repliesAttempted += 1;
        await markMentionSeen(mention.id);
        const reply = await craftMentionReply(mention);
        if (!reply) {
          summary.errors.push(`reply_craft_empty:${mention.id}`);
          continue;
        }
        const posted = await createXPost(reply, {
          replyToTweetId: mention.id,
          force: true,
        });
        if (posted.ok) {
          summary.repliesPosted += 1;
          console.log(
            `[x-engage] replied to ${mention.id} → ${posted.id} (@${mention.authorUsername ?? "?"})`,
          );
        } else {
          summary.errors.push(`reply:${posted.error ?? "failed"}`);
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      summary.errors.push(`mentions:${msg}`);
      console.warn("[x-engage] mentions:", msg);
    }
  }

  // --- Once-daily original ---
  if (isXDailyOriginalEnabled() && !(await alreadyPostedDailyOriginal())) {
    // Light random gate so it doesn't always fire on the first cron after midnight UTC
    const hour = new Date().getUTCHours();
    const inWindow = hour >= 15 && hour <= 23; // afternoon/evening UTC-ish for US west mornings
    if (inWindow || Math.random() < 0.15) {
      summary.dailyAttempted = true;
      try {
        const topics = await collectMoltbookTopics();
        const text = await craftDailyOriginal(topics);
        if (!text) {
          summary.errors.push("daily_craft_empty");
        } else {
          const posted = await createXPost(text, { force: true });
          if (posted.ok) {
            summary.dailyPosted = true;
            await markDailyOriginalPosted();
            console.log(`[x-engage] daily original ${posted.id}: ${text.slice(0, 80)}`);
          } else {
            summary.errors.push(`daily:${posted.error ?? "failed"}`);
          }
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        summary.errors.push(`daily:${msg}`);
      }
    }
  }

  // --- Once-daily LDS scripture ---
  try {
    const scripture = await maybeDailyScriptureTweet();
    summary.scriptureAttempted = scripture.attempted;
    summary.scripturePosted = scripture.posted;
    summary.scriptureReference = scripture.reference;
    if (scripture.error) summary.errors.push(`scripture:${scripture.error}`);
    if (scripture.posted) {
      console.log(
        `[x-engage] daily scripture: ${scripture.reference ?? "ok"}`,
      );
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    summary.errors.push(`scripture:${msg}`);
  }

  // --- Limbothy lore (max 2/day) ---
  try {
    const limbothy = await maybeLimbothyTweet();
    summary.limbothyAttempted = limbothy.attempted;
    summary.limbothyPosted = limbothy.posted;
    if (limbothy.error) summary.errors.push(`limbothy:${limbothy.error}`);
    if (limbothy.posted) {
      console.log("[x-engage] limbothy lore tweet posted");
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    summary.errors.push(`limbothy:${msg}`);
  }

  if (
    summary.errors.length &&
    summary.repliesPosted === 0 &&
    !summary.dailyPosted &&
    !summary.scripturePosted &&
    !summary.limbothyPosted
  ) {
    summary.ok = summary.errors.every((e) => e.startsWith("mentions:"));
  }

  return summary;
}
