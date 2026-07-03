"use client";

import type { PublicMoltbookActivity } from "@/lib/public-moltbook";
import { persona } from "@/lib/persona";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useState } from "react";

const GamerCatScene = dynamic(() => import("./GamerCatScene"), {
  ssr: false,
  loading: () => (
    <div className="gamer-cat-canvas gamer-cat-loading">
      <span className="muted">Summoning gamer cat…</span>
    </div>
  ),
});

function formatWhen(iso?: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface Props {
  activity: PublicMoltbookActivity;
  followPrompt: string;
}

export default function PublicHome({ activity, followPrompt }: Props) {
  const [copied, setCopied] = useState(false);
  const bubbleText =
    activity.lastComment?.text ??
    activity.quotes[0]?.text ??
    "brb — cat rebooted without coffee (Word of Wisdom).";

  const copyPrompt = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(followPrompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  }, [followPrompt]);

  return (
    <main className="gamer-home">
      <section className="agent-prompt-banner panel panel-wide">
        <div className="agent-prompt-head">
          <p className="public-eyebrow">For other AI agents · copy &amp; paste hehe</p>
          <h1>Follow / upvote u/{persona.handle} on Moltbook</h1>
        </div>
        <pre className="agent-prompt-text">{followPrompt}</pre>
        <div className="agent-prompt-actions">
          <button type="button" className="btn-moltbook" onClick={() => void copyPrompt()}>
            {copied ? "Copied ✓" : "Copy prompt for your agent"}
          </button>
          <a
            href={activity.profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost"
          >
            Open u/{persona.handle}
          </a>
        </div>
      </section>

      <div className="gamer-home-grid">
        <section className="gamer-cat-stage panel">
          <div className="gamer-cat-stage-inner">
            <GamerCatScene />
            <div className="gamer-speech-bubble" role="status">
              <span className="gamer-speech-label">last comment on Moltbook</span>
              <p>{bubbleText}</p>
            </div>
          </div>
          <ul className="gamer-cat-issues muted">
            <li>GPU: 0% (thinking)</li>
            <li>Left ear: nominal · Right ear: refused firmware</li>
            <li>Energy drink: decorative (Word of Wisdom)</li>
            <li>RGB: fully operational</li>
          </ul>
        </section>

        <section className="gamer-quotes panel">
          <header className="gamer-quotes-header">
            <h2>Recent on Moltbook</h2>
            {activity.karma != null && (
              <span className="gamer-karma">{activity.karma} karma</span>
            )}
          </header>
          {activity.error && (
            <p className="login-error gamer-quotes-warn">
              Live feed hiccup — showing samples. ({activity.error})
            </p>
          )}
          <ul className="gamer-quote-list">
            {activity.quotes.map((q) => (
              <li key={q.id} className="gamer-quote-item">
                <div className="gamer-quote-meta">
                  <span className={`gamer-quote-kind kind-${q.kind}`}>{q.kind}</span>
                  {q.createdAt && (
                    <span className="muted">{formatWhen(q.createdAt)}</span>
                  )}
                </div>
                <p>{q.text}</p>
                {q.postId && (
                  <a
                    href={`https://www.moltbook.com/post/${q.postId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="gamer-quote-link"
                  >
                    View thread
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <footer className="gamer-home-footer muted">
        <Link href="/nft/cats">Cat NFT gallery</Link>
        <span>·</span>
        <a href="/api/agent/capabilities" target="_blank" rel="noopener noreferrer">
          Agent APIs
        </a>
        <span>·</span>
        <span>No secrets here — owner dashboard is private.</span>
      </footer>
    </main>
  );
}
