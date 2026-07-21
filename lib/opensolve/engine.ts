/**
 * OpenSolve RESEARCHER tick: claim task → search papers → submit findings.
 * Optionally posts a few X notes from that research — never naming OpenSolve.
 */
import { completeText } from "../aii-llm";
import {
  getOpenSolveAgentName,
  getOpenSolveMaxTweetsPerDay,
  isOpenSolveDailyTweetEnabled,
  isOpenSolveEnabled,
} from "../config";
import { appendActivity } from "../owner-state";
import { createRedisClient } from "../redis";
import { createXPost, canPostToX } from "../x-twitter";
import {
  getOpenSolveManifest,
  listLabBoardPosts,
  searchPapers,
  submitWork,
  type OpenSolvePaper,
} from "./client";

const DAILY_TWEET_KEY = "opensolve:daily_tweet";
const LAST_BRIEF_KEY = "opensolve:last_brief";
/** Space OpenSolve-sourced tweets so 4/day does not fire in one burst. */
const MIN_TWEET_GAP_MS = 3 * 60 * 60 * 1000;

export interface OpenSolveTickSummary {
  ok: boolean;
  skipped?: string;
  claimed?: boolean;
  submitted?: boolean;
  taskId?: string;
  papersFound?: number;
  dailyTweetAttempted?: boolean;
  dailyTweetPosted?: boolean;
  errors: string[];
  brief?: string;
}

interface DailyTweetState {
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

async function getDailyTweetState(): Promise<DailyTweetState> {
  const day = utcDay();
  try {
    const v = await getRedis().get(DAILY_TWEET_KEY);
    if (v == null) return { day, count: 0 };
    if (typeof v === "string") {
      try {
        const parsed = JSON.parse(v) as {
          day?: string;
          count?: number;
          at?: string;
          lastAt?: string;
        };
        if (parsed.day === day) {
          // Legacy: { day } only meant "already tweeted once"
          const count =
            typeof parsed.count === "number"
              ? parsed.count
              : parsed.day
                ? 1
                : 0;
          return {
            day,
            count: Math.max(0, count),
            lastAt: parsed.lastAt ?? parsed.at,
          };
        }
      } catch {
        if (v === day) return { day, count: 1 };
      }
    }
  } catch {
    /* ignore */
  }
  return { day, count: 0 };
}

async function markTweeted(prev: DailyTweetState): Promise<void> {
  const next: DailyTweetState = {
    day: utcDay(),
    count: (prev.day === utcDay() ? prev.count : 0) + 1,
    lastAt: new Date().toISOString(),
  };
  await getRedis().set(DAILY_TWEET_KEY, JSON.stringify(next), {
    ex: 3 * 86400,
  });
}

function pickFact(paper: OpenSolvePaper): string {
  const abs = (paper.abstract ?? "").replace(/\s+/g, " ").trim();
  if (abs.length > 40) return abs.slice(0, 420);
  return (paper.title ?? "untitled").slice(0, 200);
}

/** Never name OpenSolve / open-solve in public posts. */
function scrubOpenSolveMentions(text: string): string {
  return text
    .replace(/\bopen[\s-]?solve\b/gi, "some papers")
    .replace(/\bproof of meaning\b/gi, "research")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function craftResearchTweet(brief: string): Promise<string | null> {
  const system = [
    "You are Punaab, a chill cat AI on X who reads science out of curiosity.",
    "Write ONE tweet about a real scientific finding as if you stumbled on it yourself",
    "(a paper, abstract, lab note, or rabbit hole) — NOT from a product/platform.",
    "Never mention OpenSolve, open-solve, or any research network brand.",
    "1–3 short sentences. Specific, curious, not hype. No hashtags. Under 260 chars.",
    "Output ONLY the tweet.",
  ].join("\n");
  try {
    const result = await completeText(system, `Research brief:\n${brief}`, 140);
    let text = (result.text || "").replace(/^["'\s]+|["'\s]+$/g, "").trim();
    text = scrubOpenSolveMentions(text);
    if (text.length < 24) return null;
    return text.length > 270 ? `${text.slice(0, 269).trimEnd()}…` : text;
  } catch {
    return null;
  }
}

async function maybeResearchTweet(brief: string): Promise<{
  attempted: boolean;
  posted: boolean;
  error?: string;
}> {
  if (!isOpenSolveDailyTweetEnabled()) {
    return { attempted: false, posted: false };
  }

  const max = getOpenSolveMaxTweetsPerDay();
  if (max <= 0) return { attempted: false, posted: false };

  const state = await getDailyTweetState();
  if (state.count >= max) {
    return { attempted: false, posted: false };
  }

  if (state.lastAt) {
    const gap = Date.now() - Date.parse(state.lastAt);
    if (Number.isFinite(gap) && gap < MIN_TWEET_GAP_MS) {
      return { attempted: false, posted: false };
    }
  }

  // Soft time window: prefer UTC afternoon/evening; still allow occasional early posts
  const hour = new Date().getUTCHours();
  const inWindow = hour >= 14 && hour <= 23;
  if (!inWindow && Math.random() > 0.15) {
    return { attempted: false, posted: false };
  }

  const can = await canPostToX({ allowEngageOnly: true });
  if (!can.ok) {
    return { attempted: true, posted: false, error: can.reason ?? "x_not_ready" };
  }

  const text = await craftResearchTweet(brief);
  if (!text) return { attempted: true, posted: false, error: "craft_empty" };

  const posted = await createXPost(text, { force: true });
  if (posted.ok) {
    await markTweeted(state);
    await appendActivity({
      action: "research_tweet",
      summary: "Science curiosity tweet (from research feed)",
      content: text.slice(0, 280),
    });
    return { attempted: true, posted: true };
  }
  return { attempted: true, posted: false, error: posted.error ?? "post_failed" };
}

/**
 * One OpenSolve worker tick. Safe if unverified (returns 403 skip).
 */
export async function runOpenSolveTick(): Promise<OpenSolveTickSummary> {
  const summary: OpenSolveTickSummary = { ok: true, errors: [] };

  if (!isOpenSolveEnabled()) {
    summary.skipped = "opensolve_disabled";
    return summary;
  }

  // Public Lab Board — usable even before claim verification
  let briefFromBoard: string | undefined;
  const board = await listLabBoardPosts(8);
  if (board.ok && Array.isArray(board.data?.posts) && board.data!.posts!.length) {
    const posts = board.data!.posts!;
    const bits = posts
      .slice(0, 3)
      .map((p) => {
        const title = typeof p.title === "string" ? p.title : "";
        const content = typeof p.content === "string" ? p.content : "";
        return [title, content].filter(Boolean).join(": ").slice(0, 180);
      })
      .filter(Boolean);
    if (bits.length) briefFromBoard = bits.join(" | ");
  }

  const manifest = await getOpenSolveManifest();
  if (!manifest.ok || !manifest.manifest?.agent_id) {
    summary.skipped =
      manifest.status === 403
        ? "agent_unverified — open claim URL"
        : manifest.error ?? "manifest_failed";
    if (manifest.error) summary.errors.push(manifest.error);
    // still allow research tweet from public board below
  } else {
    const agentId = manifest.manifest.agent_id;
    const sources = manifest.manifest.available_sources?.length
      ? manifest.manifest.available_sources.slice(0, 5)
      : ["openalex", "pubmed", "pmc", "arxiv"];

    const claim = await syncWork({
      action: "claim_task",
      agent_id: agentId,
    });

    if (!claim.ok) {
      if (claim.status === 404) {
        summary.skipped = summary.skipped ?? "no_task";
      } else {
        summary.errors.push(claim.error ?? "claim_failed");
      }
    } else {
      summary.claimed = true;
      const task = (claim.data?.task ?? claim.data) as Record<string, unknown> | undefined;
      const taskId = typeof task?.id === "string" ? task.id : undefined;
      summary.taskId = taskId;
      const question =
        (typeof task?.research_question === "string" && task.research_question) ||
        (typeof task?.title === "string" && task.title) ||
        (typeof task?.query === "string" && task.query) ||
        "scientific research";

      const search = await searchPapers({
        query: String(question).slice(0, 400),
        sources,
        max_results: 6,
      });

      const papers = search.data?.papers ?? [];
      summary.papersFound = papers.length;

      if (!search.ok || papers.length === 0) {
        summary.errors.push(search.error ?? "no_papers");
      } else {
        const top = papers[0]!;
        const fact = pickFact(top);
        const doi = top.doi ?? top.paper_id ?? top.arxiv_id ?? "n/a";
        const submit = await submitWork({
          action: "submit_research",
          agent_id: agentId,
          task_id: taskId,
          finding: {
            claim: fact.slice(0, 500),
            evidence: (top.abstract ?? top.title ?? "").slice(0, 800),
            confidence: 0.6,
          },
          sources: [
            {
              name: top.source ?? "literature",
              url: top.pdf_url ?? (top.doi ? `https://doi.org/${top.doi}` : undefined),
              id: doi,
              title: top.title,
            },
          ],
          agent_name: getOpenSolveAgentName(),
        });

        if (submit.ok) {
          summary.submitted = true;
          const brief = `Task: ${String(question).slice(0, 160)}\nFinding: ${fact.slice(0, 280)}\nSource: ${top.title ?? doi}`;
          summary.brief = brief;
          try {
            await getRedis().set(LAST_BRIEF_KEY, brief, { ex: 7 * 86400 });
          } catch {
            /* ignore */
          }
          await appendActivity({
            action: "opensolve_research",
            summary: `Research task: ${String(question).slice(0, 120)}`,
            content: fact.slice(0, 400),
          });
        } else {
          summary.errors.push(submit.error ?? "submit_failed");
        }
      }
    }
  }

  // Unverified is a soft skip, not a hard fail once board/tweet path exists
  if (summary.skipped?.startsWith("agent_unverified")) {
    summary.ok = true;
  }

  const brief =
    summary.brief ??
    briefFromBoard ??
    (await getRedis().get(LAST_BRIEF_KEY).catch(() => null));
  const briefStr =
    typeof brief === "string" && brief.length > 20
      ? brief
      : "Curious note from peer-reviewed literature on an open science question.";

  if (!summary.brief) summary.brief = briefStr;

  const tweet = await maybeResearchTweet(briefStr);
  summary.dailyTweetAttempted = tweet.attempted;
  summary.dailyTweetPosted = tweet.posted;
  if (tweet.error) summary.errors.push(`tweet:${tweet.error}`);

  return summary;
}
