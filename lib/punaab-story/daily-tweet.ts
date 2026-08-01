/**
 * Traveling Bard story tweets — up to 4 per UTC day (one NX slot per time window).
 * Never Limbothy/Jimothy. Links rotate across punaab.com and Pump $Punaab.
 */
import { completeText } from "../aii-llm";
import {
  getPublicShareUrl,
  getPunaabStoryMaxTweetsPerDay,
  isPunaabStoryTweetsEnabled,
} from "../config";
import { appendActivity } from "../owner-state";
import { personaSystemPrompt } from "../persona";
import { createRedisClient } from "../redis";
import { claimDailySlot, releaseDailySlot } from "../x-daily-slot";
import { canPostToX, createXPost } from "../x-twitter";
import {
  PUNAAB_MINT,
  PUNAAB_PUMP_URL,
  PUNAAB_STORY_BIBLE,
  pickStoryAngle,
  type StoryLinkMode,
} from "./lore";

const RECENT_KEY = "x:engage:punaab_story_recent";
const RECENT_MAX = 32;

export interface PunaabStoryTweetSummary {
  attempted: boolean;
  posted: boolean;
  error?: string;
  slot?: string;
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
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\$punaab/gi, "")
    .replace(new RegExp(PUNAAB_MINT, "gi"), "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tooSimilar(candidate: string, recent: string[]): boolean {
  const a = normalizeForCompare(candidate);
  if (a.length < 18) return true;
  for (const prev of recent) {
    const b = normalizeForCompare(prev);
    if (!b) continue;
    if (a === b) return true;
    const words = a.split(" ").filter((w) => w.length > 3);
    let hits = 0;
    for (const w of words) {
      if (b.includes(w)) hits += 1;
    }
    if (words.length > 0 && hits / words.length >= 0.68) return true;
  }
  return false;
}

/**
 * Four UTC windows → at most 4 posts/day when max≥4.
 * Slot index 0..3 maps to morning / midday / afternoon / night.
 */
export function storyWindowSlot(maxPerDay: number): {
  slot: string;
  index: number;
} | null {
  const max = Math.max(0, Math.min(4, Math.floor(maxPerDay)));
  if (max <= 0) return null;

  const hour = new Date().getUTCHours();
  // Soft spread: only attempt inside the active slice of the window
  // so we don't always fire on the first heartbeat of the block.
  const windows: Array<{ index: number; start: number; end: number }> = [
    { index: 0, start: 2, end: 8 },
    { index: 1, start: 8, end: 14 },
    { index: 2, start: 14, end: 20 },
    { index: 3, start: 20, end: 26 }, // 20–24 wraps via hour+24 check below
  ].slice(0, max);

  for (const w of windows) {
    const inWindow =
      w.end <= 24
        ? hour >= w.start && hour < w.end
        : hour >= w.start || hour < w.end - 24;
    if (!inWindow) continue;
    // First heartbeat in each UTC window claims the slot (NX). No soft skip —
    // missed windows were why X went silent after Limbothy was disabled.
    return { slot: `punaab_story_${w.index}`, index: w.index };
  }
  return null;
}

function appendLink(body: string, mode: StoryLinkMode): string {
  let out = body.trim();
  const site = `${getPublicShareUrl()}/`;
  const bits: string[] = [];
  if (mode === "site" || mode === "both") bits.push(site);
  if (mode === "pump" || mode === "both") bits.push(PUNAAB_PUMP_URL);
  if (mode === "soft") {
    // Soft CTA: site more often; sometimes ticker only
    if (Math.random() < 0.65) bits.push(site);
    else if (Math.random() < 0.5) bits.push(PUNAAB_PUMP_URL);
    else if (!/\$punaab/i.test(out)) out = `${out}\n$PUNAAB`;
  }

  for (const link of bits) {
    const line = `\n${link}`;
    if (out.length + line.length <= 280) out = `${out}${line}`;
  }
  if (out.length > 280) out = `${out.slice(0, 279).trimEnd()}…`;
  return out;
}

async function craftStoryTweet(
  recent: string[],
  slotIndex: number,
): Promise<{ body: string; link: StoryLinkMode } | null> {
  const picked = pickStoryAngle(slotIndex);
  const recentBlock =
    recent.length > 0
      ? recent
          .slice(0, 10)
          .map((t, i) => `${i + 1}. ${t.slice(0, 150)}`)
          .join("\n")
      : "(none yet)";

  const system = [
    personaSystemPrompt(),
    "",
    "Write ONE original X/Twitter post as a short story scrap about Punaab the Traveling Bard.",
    "Voice: intellectual, quirky, creative, short and sweet — vignette / koan / roadside anecdote.",
    "Goal: make a curious human want to open the site, write lore, or peek at $PUNAAB — without sounding like an ad.",
    "1–3 short sentences. Specific imagery. No hashtag spam. No ALL CAPS hype.",
    "Never mention Limbothy, Jimothy, OpenSolve, or any other meme coin brand.",
    "Never mention punaab.vercel.app, Vercel, or any *.vercel.app URL. Humans go to punaab.com only.",
    "Do NOT invent prices, market caps, or guaranteed returns. Do NOT paste URLs — those are added later.",
    "Under 200 characters. Output ONLY the tweet text.",
  ].join("\n");

  const user = [
    "Story bible:",
    PUNAAB_STORY_BIBLE,
    "",
    `Angle: ${picked.angle}`,
    `Intended link flavor (do not paste URL): ${picked.link}`,
    "",
    "Recently posted (do not repeat or paraphrase closely):",
    recentBlock,
    "",
    "Write a brand-new scrap of the road.",
  ].join("\n");

  try {
    const result = await completeText(system, user, 140);
    let text = (result.text || "")
      .replace(/^["'\s]+|["'\s]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    text = text
      .replace(/https?:\/\/\S+/gi, "")
      .replace(/\blimbothy\b/gi, "")
      .replace(/\bjimothy\b/gi, "")
      .replace(/\bpunaab\.vercel\.app\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    if (/vercel\.app/i.test(text)) return null;
    if (text.length < 28 || text.length > 220) return null;
    if (tooSimilar(text, recent)) return null;
    return { body: text, link: picked.link };
  } catch (error) {
    console.warn("[punaab-story] craft:", error);
    return null;
  }
}

export async function maybePunaabStoryTweet(): Promise<PunaabStoryTweetSummary> {
  if (!isPunaabStoryTweetsEnabled()) {
    return { attempted: false, posted: false };
  }

  const max = getPunaabStoryMaxTweetsPerDay();
  const window = storyWindowSlot(max);
  if (!window) {
    return { attempted: false, posted: false };
  }

  const can = await canPostToX({ allowEngageOnly: true });
  if (!can.ok) {
    return { attempted: true, posted: false, error: can.reason ?? "x_not_ready" };
  }

  const slot = await claimDailySlot(window.slot);
  if (!slot.claimed) {
    return { attempted: false, posted: false, slot: window.slot };
  }

  const recent = await getRecentTweets();
  let crafted: { body: string; link: StoryLinkMode } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    crafted = await craftStoryTweet(recent, window.index);
    if (crafted) break;
  }
  if (!crafted) {
    await releaseDailySlot(window.slot, slot.day);
    return {
      attempted: true,
      posted: false,
      error: "craft_empty_or_duplicate",
      slot: window.slot,
    };
  }

  const text = appendLink(crafted.body, crafted.link);
  const posted = await createXPost(text, { force: true });
  if (!posted.ok) {
    await releaseDailySlot(window.slot, slot.day);
    return {
      attempted: true,
      posted: false,
      error: posted.error ?? "post_failed",
      slot: window.slot,
    };
  }

  await rememberTweet(crafted.body);
  await appendActivity({
    action: "punaab_story_tweet",
    summary: `Traveling Bard story tweet (${window.slot})`,
    content: text.slice(0, 280),
  });

  return { attempted: true, posted: true, slot: window.slot };
}
