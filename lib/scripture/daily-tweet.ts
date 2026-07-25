/**
 * Once-daily X post: a random (day-stable) LDS standard-works verse.
 */
import { appendActivity } from "../owner-state";
import { createRedisClient } from "../redis";
import { canPostToX, createXPost } from "../x-twitter";
import { isXDailyScriptureEnabled } from "../config";
import { pickScriptureForDay, type ScriptureRef } from "./verses";

const DAILY_KEY = "x:engage:daily_scripture";

export interface ScriptureTweetSummary {
  attempted: boolean;
  posted: boolean;
  reference?: string;
  error?: string;
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

async function alreadyPostedToday(): Promise<boolean> {
  try {
    const v = await createRedisClient().get(`${DAILY_KEY}:${utcDay()}`);
    return v != null;
  } catch {
    return false;
  }
}

/** Claim today's slot atomically so concurrent crons don't double-post. */
async function claimTodaySlot(): Promise<boolean> {
  try {
    const r = createRedisClient();
    const res = await r.set(`${DAILY_KEY}:${utcDay()}`, new Date().toISOString(), {
      nx: true,
      ex: 3 * 86400,
    });
    return res === "OK";
  } catch (error) {
    console.warn("[scripture] claim slot:", error);
    return false;
  }
}

async function releaseTodaySlot(): Promise<void> {
  try {
    await createRedisClient().del(`${DAILY_KEY}:${utcDay()}`);
  } catch {
    /* ignore */
  }
}

async function fetchVerse(
  ref: ScriptureRef,
): Promise<{ reference: string; text: string } | null> {
  const url = `https://openscriptureapi.org/api/scriptures/v1/lds/en/book/${ref.bookId}/${ref.chapter}/${ref.verse}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      reference?: string;
      text?: string;
    };
    const text = (json.text ?? "").replace(/\s+/g, " ").trim();
    if (text.length < 12) return null;
    return {
      reference: (json.reference ?? ref.label).trim(),
      text,
    };
  } catch (error) {
    console.warn("[scripture] fetch:", error);
    return null;
  }
}

function formatScriptureTweet(reference: string, text: string): string {
  const maxBody = 240;
  let body = text;
  if (body.length > maxBody) {
    body = `${body.slice(0, maxBody - 1).trimEnd()}…`;
  }
  const tweet = `"${body}"\n— ${reference}`;
  if (tweet.length <= 280) return tweet;
  const room = 280 - reference.length - 8;
  return `"${text.slice(0, Math.max(40, room)).trimEnd()}…"\n— ${reference}`;
}

/**
 * Soft window so it doesn't always fire on the first heartbeat after midnight UTC.
 * Prefer morning-ish US West (UTC 14–22).
 */
function inSoftWindow(): boolean {
  const hour = new Date().getUTCHours();
  if (hour >= 14 && hour <= 22) return true;
  return Math.random() < 0.12;
}

export async function maybeDailyScriptureTweet(): Promise<ScriptureTweetSummary> {
  if (!isXDailyScriptureEnabled()) {
    return { attempted: false, posted: false };
  }
  if (await alreadyPostedToday()) {
    return { attempted: false, posted: false };
  }
  if (!inSoftWindow()) {
    return { attempted: false, posted: false };
  }

  const can = await canPostToX({ allowEngageOnly: true });
  if (!can.ok) {
    return { attempted: true, posted: false, error: can.reason ?? "x_not_ready" };
  }

  if (!(await claimTodaySlot())) {
    return { attempted: false, posted: false };
  }

  const ref = pickScriptureForDay(utcDay());
  const verse = await fetchVerse(ref);
  if (!verse) {
    await releaseTodaySlot();
    return { attempted: true, posted: false, error: `fetch_failed:${ref.label}` };
  }

  const text = formatScriptureTweet(verse.reference, verse.text);
  const posted = await createXPost(text, { force: true });
  if (!posted.ok) {
    await releaseTodaySlot();
    return {
      attempted: true,
      posted: false,
      reference: verse.reference,
      error: posted.error ?? "post_failed",
    };
  }

  await appendActivity({
    action: "scripture_tweet",
    summary: `Daily scripture: ${verse.reference}`,
    content: text.slice(0, 280),
  });

  return {
    attempted: true,
    posted: true,
    reference: verse.reference,
  };
}
