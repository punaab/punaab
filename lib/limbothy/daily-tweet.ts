/**
 * Occasional Limbothy lore tweets — max 2 per UTC day.
 */
import {
  getLimbothyMaxTweetsPerDay,
  getLimbothyMint,
  isLimbothyTweetsEnabled,
} from "../config";
import { appendActivity } from "../owner-state";
import { createRedisClient } from "../redis";
import { canPostToX, createXPost } from "../x-twitter";
import { LIMBOTHY_MINT, pickLimbothyBit } from "./lore";

const DAY_KEY = "x:engage:limbothy_day";
const MIN_GAP_MS = 5 * 60 * 60 * 1000; // space the two posts

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

function formatTweet(bit: string, includeCa: boolean): string {
  let text = bit.trim();
  if (includeCa) {
    const mint = getLimbothyMint() || LIMBOTHY_MINT;
    const caLine = `\n$LIMBOTHY\n${mint}`;
    if (text.length + caLine.length <= 280) text = `${text}${caLine}`;
  }
  if (text.length > 280) text = `${text.slice(0, 279).trimEnd()}…`;
  return text;
}

function inSoftWindow(): boolean {
  const hour = new Date().getUTCHours();
  // Spread across the day; prefer US-friendly windows
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

  if (state.lastAt) {
    const gap = Date.now() - Date.parse(state.lastAt);
    if (Number.isFinite(gap) && gap < MIN_GAP_MS) {
      return { attempted: false, posted: false };
    }
  }

  if (!inSoftWindow()) {
    return { attempted: false, posted: false };
  }

  const can = await canPostToX({ allowEngageOnly: true });
  if (!can.ok) {
    return { attempted: true, posted: false, error: can.reason ?? "x_not_ready" };
  }

  // Include CA on ~half of posts so it's lore-first, not billboard-every-time
  const includeCa = Math.random() < 0.55;
  const text = formatTweet(pickLimbothyBit(), includeCa);

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

  await appendActivity({
    action: "limbothy_tweet",
    summary: `Limbothy lore tweet (${state.count + 1}/${max})`,
    content: text.slice(0, 280),
  });

  return { attempted: true, posted: true };
}
