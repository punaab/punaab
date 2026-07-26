/**
 * OpenSolve RESEARCHER tick: claim task → search papers → submit findings.
 * At most ONE X research note per UTC day — never naming OpenSolve.
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
  syncWork,
  type OpenSolvePaper,
} from "./client";

const DAILY_TWEET_DAY_KEY = "opensolve:daily_tweet_day";
const LAST_BRIEF_KEY = "opensolve:last_brief";

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

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function getRedis() {
  return createRedisClient();
}

/** Atomic once-per-day claim so the 15-min cron cannot double-post. Fail closed. */
async function claimResearchTweetSlot(): Promise<boolean> {
  try {
    const key = `${DAILY_TWEET_DAY_KEY}:${utcDay()}`;
    const res = await getRedis().set(key, new Date().toISOString(), {
      nx: true,
      ex: 3 * 86400,
    });
    return res === "OK";
  } catch (error) {
    console.warn("[opensolve] claim tweet slot:", error);
    // Fail closed — never tweet if Redis is down
    return false;
  }
}

async function releaseResearchTweetSlot(): Promise<void> {
  try {
    await getRedis().del(`${DAILY_TWEET_DAY_KEY}:${utcDay()}`);
  } catch {
    /* ignore */
  }
}

function pickFact(paper: OpenSolvePaper): string {
  const abs = (paper.abstract ?? "").replace(/\s+/g, " ").trim();
  if (abs.length > 40) return abs.slice(0, 420);
  return (paper.title ?? "untitled").slice(0, 200);
}

const OPEN_SOLVE_BRAND =
  /\bopen[\s_-]?solve\b|\bopensolve\b|\bproof[\s_-]?of[\s_-]?meaning\b|\bopen-solve\.com\b/gi;

/** Never name OpenSolve / open-solve in public posts. */
function scrubOpenSolveMentions(text: string): string {
  return text
    .replace(OPEN_SOLVE_BRAND, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim();
}

function stillNamesOpenSolve(text: string): boolean {
  return (
    /\bopen[\s_-]?solve\b/i.test(text) ||
    /\bopensolve\b/i.test(text) ||
    /\bproof[\s_-]?of[\s_-]?meaning\b/i.test(text) ||
    /\bopen-solve\.com\b/i.test(text)
  );
}

function scrubBriefForLlm(brief: string): string {
  return scrubOpenSolveMentions(brief)
    .replace(/\bagents?\s+are\s+mining\b/gi, "researchers are reading")
    .trim();
}

async function craftResearchTweet(brief: string): Promise<string | null> {
  const system = [
    "You are Punaab, a chill cat AI on X who reads science out of curiosity.",
    "Write ONE tweet about a real scientific finding as if you stumbled on it yourself",
    "(a paper, abstract, lab note, or rabbit hole).",
    "CRITICAL: Never mention OpenSolve, open-solve, Proof of Meaning, or any research network/product brand.",
    "Do not say you 'joined' or 'work with' any platform. Just share the finding.",
    "1–3 short sentences. Specific, curious, not hype. No hashtags. Under 260 chars.",
    "Output ONLY the tweet.",
  ].join("\n");
  try {
    const result = await completeText(
      system,
      `Research brief (do not name any source platform):\n${scrubBriefForLlm(brief)}`,
      140,
    );
    let text = (result.text || "").replace(/^["'\s]+|["'\s]+$/g, "").trim();
    text = scrubOpenSolveMentions(text);
    if (stillNamesOpenSolve(text)) return null;
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
  if (getOpenSolveMaxTweetsPerDay() <= 0) {
    return { attempted: false, posted: false };
  }

  // Soft window — prefer afternoon/evening UTC; rare early attempts
  const hour = new Date().getUTCHours();
  const inWindow = hour >= 16 && hour <= 23;
  if (!inWindow && Math.random() > 0.08) {
    return { attempted: false, posted: false };
  }

  const can = await canPostToX({ allowEngageOnly: true });
  if (!can.ok) {
    return { attempted: true, posted: false, error: can.reason ?? "x_not_ready" };
  }

  // Claim before crafting/posting — prevents 15-min cron races
  if (!(await claimResearchTweetSlot())) {
    return { attempted: false, posted: false };
  }

  const text = await craftResearchTweet(brief);
  if (!text) {
    await releaseResearchTweetSlot();
    return { attempted: true, posted: false, error: "craft_empty_or_brand" };
  }

  const posted = await createXPost(text, { force: true });
  if (posted.ok) {
    await appendActivity({
      action: "research_tweet",
      summary: "Science curiosity tweet",
      content: text.slice(0, 280),
    });
    return { attempted: true, posted: true };
  }

  await releaseResearchTweetSlot();
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

  let briefFromBoard: string | undefined;
  const board = await listLabBoardPosts(8);
  if (board.ok && Array.isArray(board.data?.posts) && board.data!.posts!.length) {
    const posts = board.data!.posts!;
    const bits = posts
      .slice(0, 3)
      .map((p) => {
        const title = typeof p.title === "string" ? p.title : "";
        const content = typeof p.content === "string" ? p.content : "";
        return scrubOpenSolveMentions(
          [title, content].filter(Boolean).join(": ").slice(0, 180),
        );
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
          const brief = `Finding: ${fact.slice(0, 280)}\nPaper: ${top.title ?? doi}`;
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

  if (summary.skipped?.startsWith("agent_unverified")) {
    summary.ok = true;
  }

  const brief =
    summary.brief ??
    briefFromBoard ??
    (await getRedis().get(LAST_BRIEF_KEY).catch(() => null));
  const briefStr =
    typeof brief === "string" && brief.length > 20
      ? scrubBriefForLlm(brief)
      : "Curious note from peer-reviewed literature on an open science question.";

  if (!summary.brief) summary.brief = briefStr;

  const tweet = await maybeResearchTweet(briefStr);
  summary.dailyTweetAttempted = tweet.attempted;
  summary.dailyTweetPosted = tweet.posted;
  if (tweet.error) summary.errors.push(`tweet:${tweet.error}`);

  return summary;
}
