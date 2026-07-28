"use client";

import { SignInButton, useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  downloadLabelForCategory,
  LORE_COMMENT_MAX,
  loreCategoryMeta,
  type CommunityLoreDetail,
} from "@/lib/community-lore";

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function LoreDetail({ id }: { id: string }) {
  const { isSignedIn, isLoaded } = useAuth();
  const [lore, setLore] = useState<CommunityLoreDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/community/lore/${id}`);
      const data = (await res.json()) as {
        lore?: CommunityLoreDetail;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error || "Lore not found.");
        setLore(null);
        return;
      }
      setLore(data.lore || null);
    } catch {
      setError("Could not load this lore.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleVote() {
    if (!isSignedIn || !lore || lore.isHub) return;
    const res = await fetch(`/api/community/lore/${id}/vote`, { method: "POST" });
    const data = (await res.json()) as {
      voteCount?: number;
      votedByMe?: boolean;
      error?: string;
    };
    if (!res.ok) {
      setError(data.error || "Could not vote.");
      return;
    }
    setLore({
      ...lore,
      voteCount: data.voteCount ?? lore.voteCount,
      votedByMe: Boolean(data.votedByMe),
    });
  }

  async function submitComment(event: React.FormEvent) {
    event.preventDefault();
    if (!isSignedIn) return;
    setPosting(true);
    setError(null);
    try {
      const res = await fetch(`/api/community/lore/${id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: comment }),
      });
      const data = (await res.json()) as {
        comment?: CommunityLoreDetail["comments"][number];
        error?: string;
      };
      if (!res.ok) {
        setError(data.error || "Could not comment.");
        return;
      }
      setComment("");
      if (data.comment && lore) {
        setLore({
          ...lore,
          comments: [...lore.comments, data.comment],
          commentCount: lore.commentCount + 1,
        });
      } else {
        await load();
      }
    } finally {
      setPosting(false);
    }
  }

  if (loading) {
    return <p className="lore-empty">Opening the scroll…</p>;
  }

  if (!lore) {
    return (
      <div className="lore-empty-card">
        <h3>Lost on the road</h3>
        <p>{error || "This lore could not be found."}</p>
        <Link className="btn ghost" href="/world">
          Back to lore
        </Link>
      </div>
    );
  }

  const meta = loreCategoryMeta(lore.category);
  const connections = [...(lore.linksOut || []), ...(lore.linksIn || [])];

  return (
    <article className="lore-detail">
      <div className="lore-detail-nav">
        <Link className="lore-back" href="/world">
          ← World home
        </Link>
        <Link className="lore-back" href={`/world/${lore.category}`}>
          {meta.label}
        </Link>
      </div>

      <header className="lore-detail-head">
        <button
          type="button"
          className={`lore-vote lore-vote-lg${lore.votedByMe ? " is-voted" : ""}`}
          onClick={toggleVote}
          disabled={!isSignedIn || lore.isHub}
          title={
            lore.isHub
              ? "Hub node"
              : isSignedIn
                ? "Upvote"
                : "Sign in to upvote"
          }
        >
          <span aria-hidden="true">▲</span>
          <strong>{lore.voteCount}</strong>
        </button>
        <div>
          <span className="lore-chip">{meta.label}</span>
          {lore.isHub && <span className="lore-chip">Hub</span>}
          {lore.status !== "accepted" && (
            <span className={`lore-status is-${lore.status}`}>{lore.status}</span>
          )}
          <h1>{lore.title}</h1>
          {lore.summary && <p className="lore-detail-summary">{lore.summary}</p>}
          <p className="lore-card-meta">
            <span>{lore.authorName}</span>
            <span className="dot">•</span>
            <span>{formatWhen(lore.createdAt)}</span>
            {lore.locationKey && (
              <>
                <span className="dot">•</span>
                <span>{lore.locationKey}</span>
              </>
            )}
          </p>
        </div>
      </header>

      {lore.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={lore.imageUrl}
          alt=""
          className="lore-detail-image"
        />
      )}

      <div className="lore-detail-body">{lore.body}</div>

      {lore.tags?.length > 0 && (
        <p className="lore-tags">
          {lore.tags.map((tag) => (
            <span key={tag} className="lore-chip">
              {tag}
            </span>
          ))}
        </p>
      )}

      {connections.length > 0 && (
        <section className="lore-connections">
          <h2>Connections</h2>
          <ul>
            {lore.linksOut.map((edge) => (
              <li key={`out-${edge.to}-${edge.kind}`}>
                <span className="meta">{edge.kind.replace(/_/g, " ")}</span>{" "}
                <Link href={`/world/${edge.to}`}>{edge.title}</Link>
              </li>
            ))}
            {lore.linksIn.map((edge) => (
              <li key={`in-${edge.from}-${edge.kind}`}>
                <span className="meta">from {edge.kind.replace(/_/g, " ")}</span>{" "}
                <Link href={`/world/${edge.from}`}>{edge.title}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="hero-actions" style={{ marginBottom: "1.25rem" }}>
        <a
          className="btn ghost"
          href={`/api/community/lore/export?node=${lore.id}`}
        >
          {downloadLabelForCategory(lore.category).replace(
            /^Download /,
            "Download this "
          )}
        </a>
      </div>

      {error && <p className="lore-error">{error}</p>}

      <section className="lore-comments">
        <h2>
          {lore.commentCount}{" "}
          {lore.commentCount === 1 ? "comment" : "comments"}
        </h2>

        {isLoaded && isSignedIn ? (
          <form className="lore-compose lore-compose-tight" onSubmit={submitComment}>
            <label className="lore-field">
              <span>Your comment</span>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={LORE_COMMENT_MAX}
                rows={4}
                placeholder="Add a note, tweak, or alternate line…"
                required
              />
            </label>
            <div className="lore-compose-actions">
              <p className="meta">
                {comment.trim().length}/{LORE_COMMENT_MAX}
              </p>
              <button type="submit" className="btn primary" disabled={posting}>
                {posting ? "Posting…" : "Comment"}
              </button>
            </div>
          </form>
        ) : (
          <div className="lore-signin-hint">
            <SignInButton mode="modal">
              <button type="button" className="btn soft">
                Sign in to comment
              </button>
            </SignInButton>
          </div>
        )}

        <ul className="lore-comment-list">
          {lore.comments.map((entry) => (
            <li key={entry.id} className="lore-comment">
              <p className="lore-comment-meta">
                <strong>{entry.authorName}</strong>
                <span className="dot">•</span>
                <span>{formatWhen(entry.createdAt)}</span>
              </p>
              <p>{entry.body}</p>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
