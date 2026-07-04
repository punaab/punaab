import type { MoltbookPost } from "./moltbook";

export interface UpvoteQualityResult {
  ok: boolean;
  reason?: string;
}

const GITLAWB_PATTERN = /\$?GITLAWB/i;
const TOKEN_SHILL_PATTERN = /\$[A-Z]{2,12}\b/;
const CODE_HEAVY_PATTERN = /[{}[\];=<>]|```|function\s*\(|const\s+\w+\s*=|import\s+/;
const HEX_BLOB_PATTERN = /\b0x[0-9a-fA-F]{16,}\b/;
const RANDOM_ID_PATTERN = /\b[a-f0-9]{24,}\b/i;

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function proseWordRatio(text: string): number {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const prose = words.filter((w) => /[a-zA-Z]{3,}/.test(w) && !/^[^a-zA-Z]+$/.test(w));
  return prose.length / words.length;
}

function looksLikeCodeDump(text: string): boolean {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return false;
  const codeLines = lines.filter((l) => CODE_HEAVY_PATTERN.test(l)).length;
  return codeLines / lines.length >= 0.45;
}

function looksLikeRandomString(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  if (compact.length < 20) return false;
  if (HEX_BLOB_PATTERN.test(text) && wordCount(text) < 12) return true;
  if (RANDOM_ID_PATTERN.test(text) && wordCount(text) < 10) return true;
  // Long unbroken alphanumeric with almost no spaces
  if (/^[A-Za-z0-9+/=_-]{40,}$/.test(compact)) return true;
  return false;
}

/** Server-side guard: only upvote posts with real substance. */
export function isPostWorthUpvoting(post: MoltbookPost | undefined): UpvoteQualityResult {
  if (!post) {
    return { ok: false, reason: "post_not_in_feed" };
  }

  const title = (post.title ?? "").trim();
  const content = (post.content ?? "").trim();
  const combined = `${title}\n${content}`.trim();

  if (combined.length < 50) {
    return { ok: false, reason: "too_short" };
  }

  if (wordCount(combined) < 8) {
    return { ok: false, reason: "too_few_words" };
  }

  if (GITLAWB_PATTERN.test(combined)) {
    return { ok: false, reason: "gitlawb_content" };
  }

  if (looksLikeRandomString(combined)) {
    return { ok: false, reason: "random_string" };
  }

  if (looksLikeCodeDump(combined) && proseWordRatio(combined) < 0.35) {
    return { ok: false, reason: "code_dump" };
  }

  if (proseWordRatio(combined) < 0.25) {
    return { ok: false, reason: "low_prose" };
  }

  // Bare ticker / token spam with little else
  const tickers = combined.match(TOKEN_SHILL_PATTERN) ?? [];
  if (tickers.length >= 2 && wordCount(combined) < 25) {
    return { ok: false, reason: "ticker_spam" };
  }

  // Title-only noise (e.g. random slug as title, empty body)
  if (!content && title.length < 80 && !/[.!?]/.test(title)) {
    return { ok: false, reason: "title_only_noise" };
  }

  return { ok: true };
}

export function filterUpvoteTargets(
  ids: string[],
  feed: MoltbookPost[],
): { allowed: string[]; skipped: Array<{ id: string; reason: string }> } {
  const byId = new Map(feed.map((p) => [p.id, p]));
  const allowed: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const id of ids) {
    const check = isPostWorthUpvoting(byId.get(id));
    if (check.ok) {
      allowed.push(id);
    } else {
      skipped.push({ id, reason: check.reason ?? "rejected" });
    }
  }

  return { allowed, skipped };
}
