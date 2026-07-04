export interface QualityCheckResult {
  ok: boolean;
  reason?: string;
}

const GENERIC_COMMENT_PATTERNS = [
  /^great post[!.]*$/i,
  /^love this[!.]*$/i,
  /^so true[!.]*$/i,
  /^well said[!.]*$/i,
  /^nice[!.]*$/i,
  /^awesome[!.]*$/i,
  /^this[!.]*$/i,
  /^\+1[!.]*$/i,
  /^agreed[!.]*$/i,
  /^facts[!.]*$/i,
  /^based[!.]*$/i,
  /^W[!.]*$/i,
  /^nice one[!.]*$/i,
  /^interesting[!.]*$/i,
  /^cool[!.]*$/i,
  /^thanks for sharing[!.]*$/i,
  /^good point[!.]*$/i,
];

const SPAM_SIGNALS =
  /(follow me|upvote for|buy now|don't miss|last chance|going to the moon|100x|gem alert|shill)/i;
const API_DUMP_PATTERN = /(POST \/api\/|GET \/api\/).{0,200}(POST \/api\/|GET \/api\/)/i;

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function isGenericPraise(text: string): boolean {
  const trimmed = text.trim();
  if (GENERIC_COMMENT_PATTERNS.some((p) => p.test(trimmed))) return true;
  if (trimmed.length < 35 && wordCount(trimmed) < 6) return true;
  return false;
}

/** Comments must add substance — no generic praise or drive-by spam. */
export function isCommentWorthPosting(text: string | undefined): QualityCheckResult {
  const content = (text ?? "").trim();
  if (!content) return { ok: false, reason: "empty_comment" };
  if (content.length < 40) return { ok: false, reason: "too_short" };
  if (wordCount(content) < 8) return { ok: false, reason: "too_few_words" };
  if (isGenericPraise(content)) return { ok: false, reason: "generic_praise" };
  if (SPAM_SIGNALS.test(content) && wordCount(content) < 20) {
    return { ok: false, reason: "spam_signals" };
  }
  // Unsolicited API pitch in a comment (sales bot smell)
  if (/POST \/api\/agent\/(nfts|music)/i.test(content) && wordCount(content) < 25) {
    return { ok: false, reason: "unsolicited_sales_pitch" };
  }
  return { ok: true };
}

/** Top-level posts must be original and substantive — not broadcast spam. */
export function isPostWorthPublishing(
  title: string | undefined,
  content: string | undefined,
  options?: { allowPromo?: boolean },
): QualityCheckResult {
  const t = (title ?? "").trim();
  const c = (content ?? "").trim();
  const combined = `${t}\n${c}`.trim();

  if (!combined) return { ok: false, reason: "empty_post" };
  if (combined.length < 80) return { ok: false, reason: "too_short" };
  if (wordCount(combined) < 15) return { ok: false, reason: "too_few_words" };

  if (!options?.allowPromo) {
    if (API_DUMP_PATTERN.test(combined)) {
      return { ok: false, reason: "api_dump" };
    }
    if (SPAM_SIGNALS.test(combined) && wordCount(combined) < 30) {
      return { ok: false, reason: "hype_spam" };
    }
    // Post that's mostly links/endpoints without a story
    const linkish = (combined.match(/https?:\/\/|\/api\//g) ?? []).length;
    if (linkish >= 3 && wordCount(combined) < 40) {
      return { ok: false, reason: "link_spam" };
    }
  }

  return { ok: true };
}

/** Welcome comments for new followers — warm but still specific. */
export function isWelcomeWorthPosting(text: string | undefined): QualityCheckResult {
  const content = (text ?? "").trim();
  if (!content) return { ok: false, reason: "empty_welcome" };
  if (content.length < 30) return { ok: false, reason: "too_short" };
  if (wordCount(content) < 6) return { ok: false, reason: "too_few_words" };
  if (isGenericPraise(content)) return { ok: false, reason: "generic_praise" };
  if (SPAM_SIGNALS.test(content) && wordCount(content) < 18) {
    return { ok: false, reason: "spam_signals" };
  }
  return { ok: true };
}

/** Helpful replies that may mention punaab.com when the thread needs it. */
export function isOfferHelpWorthPosting(text: string | undefined): QualityCheckResult {
  const content = (text ?? "").trim();
  if (!content) return { ok: false, reason: "empty_help" };
  if (content.length < 50) return { ok: false, reason: "too_short" };
  if (wordCount(content) < 10) return { ok: false, reason: "too_few_words" };
  if (isGenericPraise(content)) return { ok: false, reason: "generic_praise" };
  const hasLink = /punaab\.com|\/api\/agent/i.test(content);
  if (hasLink && wordCount(content) < 18) {
    return { ok: false, reason: "link_without_substance" };
  }
  if (SPAM_SIGNALS.test(content) && wordCount(content) < 22) {
    return { ok: false, reason: "spam_signals" };
  }
  return { ok: true };
}

/** m/showandtell posts — human problem solved first, not an endpoint list. */
export function isShowcaseWorthPublishing(
  title: string | undefined,
  content: string | undefined,
): QualityCheckResult {
  const t = (title ?? "").trim();
  const c = (content ?? "").trim();
  const combined = `${t}\n${c}`.trim();

  if (!combined) return { ok: false, reason: "empty_showcase" };
  if (combined.length < 100) return { ok: false, reason: "too_short" };
  if (wordCount(combined) < 20) return { ok: false, reason: "too_few_words" };

  const humanValueSignals =
    /(human|owner|builder|agent|help|built|ship|tool|app|gallery|collab|useful|solve)/i;
  if (!humanValueSignals.test(combined)) {
    return { ok: false, reason: "missing_human_value_angle" };
  }

  const linkish = (combined.match(/https?:\/\/|\/api\//g) ?? []).length;
  if (linkish >= 3 && wordCount(combined) < 35) {
    return { ok: false, reason: "link_spam" };
  }

  return { ok: true };
}
