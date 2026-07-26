/**
 * Once-daily X post: a random (day-stable) LDS standard-works verse.
 */
import { appendActivity } from "../owner-state";
import { canPostToX, createXPost } from "../x-twitter";
import { isXDailyScriptureEnabled } from "../config";
import { claimDailySlot, releaseDailySlot } from "../x-daily-slot";
import { pickScriptureForDay, type ScriptureRef } from "./verses";

const SLOT = "scripture";

export interface ScriptureTweetSummary {
  attempted: boolean;
  posted: boolean;
  reference?: string;
  error?: string;
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

function inSoftWindow(): boolean {
  const hour = new Date().getUTCHours();
  if (hour >= 14 && hour <= 22) return true;
  return Math.random() < 0.08;
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function maybeDailyScriptureTweet(): Promise<ScriptureTweetSummary> {
  if (!isXDailyScriptureEnabled()) {
    return { attempted: false, posted: false };
  }
  if (!inSoftWindow()) {
    return { attempted: false, posted: false };
  }

  const can = await canPostToX({ allowEngageOnly: true });
  if (!can.ok) {
    return { attempted: true, posted: false, error: can.reason ?? "x_not_ready" };
  }

  const slot = await claimDailySlot(SLOT);
  if (!slot.claimed) {
    return { attempted: false, posted: false };
  }

  const ref = pickScriptureForDay(utcDay());
  const verse = await fetchVerse(ref);
  if (!verse) {
    await releaseDailySlot(SLOT, slot.day);
    return { attempted: true, posted: false, error: `fetch_failed:${ref.label}` };
  }

  const text = formatScriptureTweet(verse.reference, verse.text);
  const posted = await createXPost(text, { force: true });
  if (!posted.ok) {
    await releaseDailySlot(SLOT, slot.day);
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
