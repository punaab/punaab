/**
 * Limbothy lore — hard max ONE tweet per UTC day (atomic Redis NX claim).
 */
import { completeText } from "../aii-llm";
import {
  getLimbothyMint,
  isLimbothyTweetsEnabled,
} from "../config";
import { appendActivity } from "../owner-state";
import { personaSystemPrompt } from "../persona";
import { createRedisClient } from "../redis";
import { claimDailySlot, releaseDailySlot } from "../x-daily-slot";
import { canPostToX, createXPost } from "../x-twitter";
import {
  LIMBOTHY_LORE_BIBLE,
  LIMBOTHY_MINT,
  pickLimbothyAngle,
} from "./lore";

const RECENT_KEY = "x:engage:limbothy_recent";
const RECENT_MAX = 24;
const SLOT = "limbothy";

export interface LimbothyTweetSummary {
  attempted: boolean;
  posted: boolean;
  error?: string;
}

async function getRecentTweets(): Promise<string[]> {
  try {
    const raw = await createRedisClient().lrange(RECENT_KEY, 0, RECENT_MAX - 1);
    return (raw ?? []).map((v) => (typeof v === "string" ? v : String(v)));
  } catch {
    return [];
  }
}

async function rememberTweet(text: string): Promise<void> {
  try {
    const r = createRedisClient();
    await r.lpush(RECENT_KEY, text.slice(0, 280));
    await r.ltrim(RECENT_KEY, 0, RECENT_MAX - 1);
  } catch {
    /* ignore */
  }
}

function normalizeForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/\$limbothy/gi, "")
    .replace(/9CtQhxDcNd3nzHE2h6v2zc2STZKXT9MYwY2e3AWapump/gi, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tooSimilar(candidate: string, recent: string[]): boolean {
  const a = normalizeForCompare(candidate);
  if (a.length < 20) return true;
  for (const prev of recent) {
    const b = normalizeForCompare(prev);
    if (!b) continue;
    if (a === b) return true;
    const words = a.split(" ").filter((w) => w.length > 3);
    let hits = 0;
    for (const w of words) {
      if (b.includes(w)) hits += 1;
    }
    if (words.length > 0 && hits / words.length >= 0.72) return true;
  }
  return false;
}

function appendCa(text: string, includeCa: boolean): string {
  let out = text.trim();
  if (includeCa) {
    const mint = getLimbothyMint() || LIMBOTHY_MINT;
    const caLine = `\n$LIMBOTHY\n${mint}`;
    if (out.length + caLine.length <= 280) out = `${out}${caLine}`;
  }
  if (out.length > 280) out = `${out.slice(0, 279).trimEnd()}…`;
  return out;
}

async function craftUniqueLimbothyTweet(recent: string[]): Promise<string | null> {
  const angle = pickLimbothyAngle();
  const recentBlock =
    recent.length > 0
      ? recent
          .slice(0, 8)
          .map((t, i) => `${i + 1}. ${t.slice(0, 160)}`)
          .join("\n")
      : "(none yet)";

  const system = [
    personaSystemPrompt(),
    "",
    "Write ONE original X/Twitter post starring Limbothy (the absurdly long-legged borzoi).",
    "Jimothy (raccoon) may appear as a friendly foil — never dunk, roast, or 'hate' on him.",
    "Keep it funny, warm, absurdist buddy-comedy energy. Limbothy-forward is fine.",
    "Use the lore bible as inspiration ONLY — invent a fresh joke/scene. Do NOT copy lines verbatim.",
    "Voice: Punaab — chill cat AI, specific, not spammy.",
    "1–3 short sentences OR a tiny dialogue. No hashtag spam. Under 220 chars before any CA.",
    "Do not invent fake prices or 'guaranteed gains'. Lore > shill.",
    "Output ONLY the tweet text.",
  ].join("\n");

  const user = [
    "Lore bible:",
    LIMBOTHY_LORE_BIBLE,
    "",
    `Today's angle: ${angle}`,
    "",
    "Recently posted (do not repeat or paraphrase closely):",
    recentBlock,
    "",
    "Write a brand-new funny Limbothy bit (be kind to Jimothy if he shows up).",
  ].join("\n");

  try {
    const result = await completeText(system, user, 160);
    let text = (result.text || "")
      .replace(/^["'\s]+|["'\s]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    text = text
      .replace(/\$LIMBOTHY/gi, "")
      .replace(/9CtQhxDcNd3nzHE2h6v2zc2STZKXT9MYwY2e3AWapump/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length < 24 || text.length > 240) return null;
    if (tooSimilar(text, recent)) return null;
    return text;
  } catch (error) {
    console.warn("[limbothy] craft:", error);
    return null;
  }
}

/** Soft gate so we don't always fire on the first heartbeat after midnight UTC. */
function inSoftWindow(): boolean {
  const hour = new Date().getUTCHours();
  if (hour >= 16 && hour <= 23) return true;
  // Outside preferred window: rarely try (still at most once/day via NX)
  return Math.random() < 0.05;
}

export async function maybeLimbothyTweet(): Promise<LimbothyTweetSummary> {
  // Permanently disabled — Traveling Bard story tweets replaced this path.
  if (!isLimbothyTweetsEnabled()) {
    return { attempted: false, posted: false };
  }

  if (!inSoftWindow()) {
    return { attempted: false, posted: false };
  }

  const can = await canPostToX({ allowEngageOnly: true });
  if (!can.ok) {
    return { attempted: true, posted: false, error: can.reason ?? "x_not_ready" };
  }

  // ATOMIC claim FIRST — concurrent heartbeats cannot all pass a read-then-write counter
  const slot = await claimDailySlot(SLOT);
  if (!slot.claimed) {
    return { attempted: false, posted: false };
  }

  const recent = await getRecentTweets();
  let body: string | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    body = await craftUniqueLimbothyTweet(recent);
    if (body) break;
  }
  if (!body) {
    await releaseDailySlot(SLOT, slot.day);
    return { attempted: true, posted: false, error: "craft_empty_or_duplicate" };
  }

  const includeCa = Math.random() < 0.5;
  const text = appendCa(body, includeCa);

  const posted = await createXPost(text, { force: true });
  if (!posted.ok) {
    await releaseDailySlot(SLOT, slot.day);
    return {
      attempted: true,
      posted: false,
      error: posted.error ?? "post_failed",
    };
  }

  await rememberTweet(body);
  await appendActivity({
    action: "limbothy_tweet",
    summary: "Limbothy lore tweet (1/day)",
    content: text.slice(0, 280),
  });

  return { attempted: true, posted: true };
}
