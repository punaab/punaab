/**
 * Limbothy lore tweets — max 1 per UTC day, freshly written (not list copy-paste).
 */
import { completeText } from "../aii-llm";
import {
  getLimbothyMaxTweetsPerDay,
  getLimbothyMint,
  isLimbothyTweetsEnabled,
} from "../config";
import { appendActivity } from "../owner-state";
import { personaSystemPrompt } from "../persona";
import { createRedisClient } from "../redis";
import { canPostToX, createXPost } from "../x-twitter";
import {
  LIMBOTHY_LORE_BIBLE,
  LIMBOTHY_MINT,
  pickLimbothyAngle,
} from "./lore";

const DAY_KEY = "x:engage:limbothy_day";
const RECENT_KEY = "x:engage:limbothy_recent";
const RECENT_MAX = 24;

export interface LimbothyTweetSummary {
  attempted: boolean;
  posted: boolean;
  error?: string;
}

interface DayState {
  day: string;
  count: number;
  lastAt?: string;
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function getRedis() {
  return createRedisClient();
}

async function getDayState(): Promise<DayState> {
  const day = utcDay();
  try {
    const raw = await getRedis().get(`${DAY_KEY}:${day}`);
    if (raw == null) return { day, count: 0 };
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw) as DayState;
        if (parsed.day === day) {
          return {
            day,
            count: Math.max(0, Number(parsed.count) || 0),
            lastAt: parsed.lastAt,
          };
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  return { day, count: 0 };
}

async function saveDayState(state: DayState): Promise<void> {
  await getRedis().set(`${DAY_KEY}:${state.day}`, JSON.stringify(state), {
    ex: 3 * 86400,
  });
}

async function getRecentTweets(): Promise<string[]> {
  try {
    const raw = await getRedis().lrange(RECENT_KEY, 0, RECENT_MAX - 1);
    return (raw ?? []).map((v) => (typeof v === "string" ? v : String(v)));
  } catch {
    return [];
  }
}

async function rememberTweet(text: string): Promise<void> {
  try {
    const r = getRedis();
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
    // crude overlap: if either contains a long shared chunk
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
    // Strip accidental CA the model may have added — we attach deliberately
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

function inSoftWindow(): boolean {
  const hour = new Date().getUTCHours();
  if (hour >= 15 && hour <= 23) return Math.random() < 0.35;
  if (hour >= 0 && hour <= 6) return Math.random() < 0.08;
  return Math.random() < 0.12;
}

export async function maybeLimbothyTweet(): Promise<LimbothyTweetSummary> {
  if (!isLimbothyTweetsEnabled()) {
    return { attempted: false, posted: false };
  }

  const max = getLimbothyMaxTweetsPerDay();
  if (max <= 0) return { attempted: false, posted: false };

  const state = await getDayState();
  if (state.count >= max) {
    return { attempted: false, posted: false };
  }

  if (!inSoftWindow()) {
    return { attempted: false, posted: false };
  }

  const can = await canPostToX({ allowEngageOnly: true });
  if (!can.ok) {
    return { attempted: true, posted: false, error: can.reason ?? "x_not_ready" };
  }

  const recent = await getRecentTweets();
  let body: string | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    body = await craftUniqueLimbothyTweet(recent);
    if (body) break;
  }
  if (!body) {
    return { attempted: true, posted: false, error: "craft_empty_or_duplicate" };
  }

  const includeCa = Math.random() < 0.55;
  const text = appendCa(body, includeCa);

  const posted = await createXPost(text, { force: true });
  if (!posted.ok) {
    return {
      attempted: true,
      posted: false,
      error: posted.error ?? "post_failed",
    };
  }

  await saveDayState({
    day: utcDay(),
    count: state.count + 1,
    lastAt: new Date().toISOString(),
  });
  await rememberTweet(body);

  await appendActivity({
    action: "limbothy_tweet",
    summary: `Limbothy lore tweet (${state.count + 1}/${max})`,
    content: text.slice(0, 280),
  });

  return { attempted: true, posted: true };
}
