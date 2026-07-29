"use client";

import { SignInButton, useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  downloadLabelForCategory,
  LORE_BODY_MAX,
  LORE_BODY_MIN,
  LORE_CATEGORIES,
  LORE_COMMENT_MAX,
  LORE_LINK_KINDS,
  LORE_SUMMARY_MAX,
  LORE_TITLE_MAX,
  loreCategoryMeta,
  type CommunityLoreDetail,
  type CommunityLoreListItem,
  type LoreCategoryId,
  type LoreLinkKind,
} from "@/lib/community-lore";

type LinkDraft = { toId: string; kind: LoreLinkKind };

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
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<LoreCategoryId>("characters");
  const [locationKey, setLocationKey] = useState("");
  const [tags, setTags] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [links, setLinks] = useState<LinkDraft[]>([]);
  const [linkQuery, setLinkQuery] = useState("");
  const [linkFilter, setLinkFilter] = useState<LoreCategoryId | "all">("all");
  const [linkChoices, setLinkChoices] = useState<CommunityLoreListItem[]>([]);
  const [linkKind, setLinkKind] = useState<LoreLinkKind>("related");

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

  function beginEdit() {
    if (!lore) return;
    const draft = lore.pendingRevision;
    setTitle(draft?.title ?? lore.title);
    setSummary(draft?.summary ?? lore.summary);
    setBody(draft?.body ?? lore.body);
    setCategory(draft?.category ?? lore.category);
    setLocationKey(draft?.locationKey ?? lore.locationKey ?? "");
    setTags((draft?.tags ?? lore.tags).join(", "));
    setImageUrl(draft?.imageUrl ?? lore.imageUrl);
    setLinks(
      draft?.links?.length
        ? draft.links.map((l) => ({ toId: l.toId, kind: l.kind }))
        : lore.linksOut.map((e) => ({ toId: e.to, kind: e.kind }))
    );
    setEditing(true);
    setStatusMsg(null);
    setError(null);
  }

  useEffect(() => {
    if (!editing) return;
    const handle = window.setTimeout(() => {
      const params = new URLSearchParams({ sort: "votes", limit: "80" });
      if (linkQuery.trim()) params.set("q", linkQuery.trim());
      if (linkFilter !== "all") params.set("category", linkFilter);
      void fetch(`/api/community/lore?${params}`)
        .then((r) => r.json())
        .then((data: { lore?: CommunityLoreListItem[] }) => {
          setLinkChoices(
            (data.lore || []).filter((item) => !item.isHub && item.id !== id)
          );
        })
        .catch(() => setLinkChoices([]));
    }, linkQuery.trim() ? 280 : 0);
    return () => window.clearTimeout(handle);
  }, [editing, linkQuery, linkFilter, id]);

  const selectedIds = useMemo(
    () => new Set(links.map((l) => l.toId)),
    [links]
  );

  function toggleLink(item: CommunityLoreListItem) {
    setLinks((prev) => {
      if (prev.some((row) => row.toId === item.id)) {
        return prev.filter((row) => row.toId !== item.id);
      }
      return [...prev, { toId: item.id, kind: linkKind }];
    });
  }

  async function onPickImage(file: File | null) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch("/api/community/lore/upload", {
        method: "POST",
        body: form,
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error || "Upload failed.");
        return;
      }
      setImageUrl(data.url);
    } catch {
      setError("Could not upload that image.");
    } finally {
      setUploading(false);
    }
  }

  async function saveEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!lore) return;
    setSaving(true);
    setError(null);
    setStatusMsg(null);
    try {
      const res = await fetch(`/api/community/lore/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          summary,
          body,
          category,
          locationKey: locationKey.trim() || null,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          imageUrl,
          links,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        message?: string;
        needsReview?: boolean;
      };
      if (!res.ok) {
        setError(data.error || "Could not save edits.");
        return;
      }
      setStatusMsg(
        data.message ||
          (data.needsReview
            ? "Edits submitted for review."
            : "Submission updated.")
      );
      setEditing(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

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
  const canEdit = Boolean(lore.isOwner && !lore.isHub);

  if (editing) {
    return (
      <article className="lore-detail">
        <div className="lore-detail-nav">
          <button type="button" className="lore-back" onClick={() => setEditing(false)}>
            ← Cancel edit
          </button>
        </div>
        <h1>Edit submission</h1>
        {lore.status === "accepted" ? (
          <p className="section-lead">
            This entry is live. Your changes go to admins for approval — the
            public version stays until they accept.
          </p>
        ) : (
          <p className="section-lead">
            Not approved yet — saving resubmits this entry for review.
          </p>
        )}
        {error && <p className="lore-error">{error}</p>}
        <form className="lore-compose" onSubmit={saveEdit}>
          <label className="lore-field">
            <span>Area</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as LoreCategoryId)}
            >
              {LORE_CATEGORIES.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.label}
                </option>
              ))}
            </select>
          </label>
          <label className="lore-field">
            <span>Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={LORE_TITLE_MAX}
              required
            />
          </label>
          <label className="lore-field">
            <span>Summary</span>
            <input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              maxLength={LORE_SUMMARY_MAX}
            />
          </label>
          <label className="lore-field">
            <span>
              Image{" "}
              {category === "art" ? "(required)" : "(optional — also adds Art)"}
            </span>
            <div className="lore-file">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(e) => onPickImage(e.target.files?.[0] || null)}
              />
            </div>
            {uploading && <span className="meta">Uploading…</span>}
            {imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="" className="lore-upload-preview" />
            )}
            {imageUrl && (
              <button
                type="button"
                className="btn soft"
                onClick={() => setImageUrl(null)}
              >
                Remove image
              </button>
            )}
          </label>
          <label className="lore-field">
            <span>Entry</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={LORE_BODY_MAX}
              minLength={LORE_BODY_MIN}
              rows={8}
              required
            />
          </label>
          <div className="lore-compose-grid">
            <label className="lore-field">
              <span>Location key</span>
              <input
                value={locationKey}
                onChange={(e) => setLocationKey(e.target.value)}
              />
            </label>
            <label className="lore-field">
              <span>Tags</span>
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="comma, separated"
              />
            </label>
          </div>

          <div className="lore-links-block">
            <div className="lore-links-head">
              <span>Connections</span>
              <label className="lore-field lore-link-kind">
                <span className="meta">Link kind</span>
                <select
                  value={linkKind}
                  onChange={(e) => setLinkKind(e.target.value as LoreLinkKind)}
                >
                  {LORE_LINK_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {kind.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <input
              className="lore-link-search"
              value={linkQuery}
              onChange={(e) => setLinkQuery(e.target.value)}
              placeholder="Search art, characters, quests…"
            />
            <div className="lore-link-filters">
              <button
                type="button"
                className={`lore-chip-btn${linkFilter === "all" ? " is-active" : ""}`}
                onClick={() => setLinkFilter("all")}
              >
                All
              </button>
              {LORE_CATEGORIES.map((area) => (
                <button
                  key={area.id}
                  type="button"
                  className={`lore-chip-btn${linkFilter === area.id ? " is-active" : ""}`}
                  onClick={() => setLinkFilter(area.id)}
                >
                  {area.label}
                </button>
              ))}
            </div>
            <ul className="lore-link-results">
              {linkChoices.slice(0, 40).map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`lore-link-pick${selectedIds.has(item.id) ? " is-on" : ""}`}
                    onClick={() => toggleLink(item)}
                  >
                    <span className="meta">
                      {loreCategoryMeta(item.category).label}
                    </span>
                    <strong>{item.title}</strong>
                  </button>
                </li>
              ))}
            </ul>
            {links.length > 0 && (
              <p className="meta">{links.length} connection(s) selected</p>
            )}
          </div>

          <div className="lore-compose-actions">
            <button
              type="submit"
              className="btn primary"
              disabled={
                saving ||
                uploading ||
                (category === "art" && !imageUrl) ||
                title.trim().length < 3 ||
                body.trim().length < LORE_BODY_MIN
              }
            >
              {saving
                ? "Saving…"
                : lore.status === "accepted"
                  ? "Submit edits for approval"
                  : "Resubmit"}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      </article>
    );
  }

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
          {lore.hasPendingRevision && (
            <span className="lore-chip lore-chip-pending">Edit awaiting review</span>
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
        <img src={lore.imageUrl} alt="" className="lore-detail-image" />
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
        {canEdit && (
          <button type="button" className="btn primary" onClick={beginEdit}>
            Edit submission
          </button>
        )}
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

      {statusMsg && <p className="lore-card-meta">{statusMsg}</p>}
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
