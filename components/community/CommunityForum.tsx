"use client";

import { SignInButton, useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LoreGraph } from "@/components/community/LoreGraph";
import { CommunityLinks } from "@/components/marketing/CommunityLinks";
import {
  clipPreview,
  downloadLabelForCategory,
  LORE_BODY_MAX,
  LORE_BODY_MIN,
  LORE_CATEGORIES,
  LORE_SUMMARY_MAX,
  LORE_TITLE_MAX,
  loreCategoryMeta,
  type CommunityLoreListItem,
  type LoreCategoryId,
  type LoreLinkKind,
  type LoreSort,
} from "@/lib/community-lore";

type ViewMode = "list" | "graph";
type LinkDraft = { toId: string; kind: LoreLinkKind };
type HomeFeed = "trending" | "latest";

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const SORT_LABELS: Record<LoreSort, string> = {
  votes: "Trending",
  newest: "Latest",
  oldest: "Oldest",
  alpha: "A–Z",
  longest: "Longest",
};

function SubmissionCard({
  item,
  isSignedIn,
  onVote,
}: {
  item: CommunityLoreListItem;
  isSignedIn: boolean;
  onVote: (id: string) => void;
}) {
  const meta = loreCategoryMeta(item.category);
  return (
    <li className="lore-submission-card">
      <div className="lore-submission-top">
        <p className="lore-submission-label">Submission</p>
        <button
          type="button"
          className={`lore-vote${item.votedByMe ? " is-voted" : ""}`}
          onClick={() => onVote(item.id)}
          disabled={!isSignedIn || item.isHub}
          title={
            item.isHub
              ? "Hub node"
              : isSignedIn
                ? "Upvote"
                : "Sign in to upvote"
          }
        >
          <span aria-hidden="true">▲</span>
          <strong>{item.voteCount}</strong>
        </button>
      </div>
      {item.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.imageUrl} alt="" className="lore-submission-thumb" />
      )}
      <div className="lore-card-topline">
        <span className="lore-chip">{meta.label}</span>
        {item.isHub && <span className="lore-chip">Hub</span>}
        {item.status === "pending" && (
          <span className="lore-chip lore-chip-pending">Pending</span>
        )}
      </div>
      <Link href={`/world/${item.id}`} className="lore-card-title">
        {item.title}
      </Link>
      <p className="lore-card-preview">
        {clipPreview(item.summary || item.body)}
      </p>
      <p className="lore-card-meta">
        <span>{item.authorName}</span>
        <span className="dot">•</span>
        <span>{formatWhen(item.createdAt)}</span>
        {item.tags.length > 0 && (
          <>
            <span className="dot">•</span>
            <span>{item.tags.slice(0, 3).join(", ")}</span>
          </>
        )}
      </p>
    </li>
  );
}

export function CommunityForum({
  initialCategory = null,
  header,
}: {
  /** null = world home (all areas). */
  initialCategory?: LoreCategoryId | null;
  /**
   * Rendered above the forum. `/world/places` passes the chart in here, and
   * hands back a location key when somebody picks a spot on it — which is why
   * this is a render prop rather than plain children: the map needs to reach
   * the compose form's `locationKey`, and that state lives in here.
   */
  header?: (api: { setLocationKey: (key: string) => void }) => React.ReactNode;
}) {
  const { isSignedIn, isLoaded } = useAuth();
  const isHome = initialCategory == null;
  const [view, setView] = useState<ViewMode>("list");
  const [category, setCategory] = useState<LoreCategoryId | null>(
    initialCategory
  );
  const [sort, setSort] = useState<LoreSort>(isHome ? "votes" : "votes");
  const [homeFeed, setHomeFeed] = useState<HomeFeed>("trending");
  const [lore, setLore] = useState<CommunityLoreListItem[]>([]);
  const [trending, setTrending] = useState<CommunityLoreListItem[]>([]);
  const [latest, setLatest] = useState<CommunityLoreListItem[]>([]);
  const [mine, setMine] = useState<CommunityLoreListItem[]>([]);
  const [linkChoices, setLinkChoices] = useState<CommunityLoreListItem[]>([]);
  const [linkQuery, setLinkQuery] = useState("");
  const [linkFilter, setLinkFilter] = useState<LoreCategoryId | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  const [locationKey, setLocationKey] = useState("");
  const [tags, setTags] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [links, setLinks] = useState<LinkDraft[]>([]);
  const [composeCategory, setComposeCategory] = useState<LoreCategoryId>(
    initialCategory ?? "characters"
  );
  const [publishing, setPublishing] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);

  const activeMeta = useMemo(
    () => (category ? loreCategoryMeta(category) : null),
    [category]
  );
  const composeMeta = useMemo(
    () => loreCategoryMeta(composeCategory),
    [composeCategory]
  );

  const downloadHref =
    view === "graph" || isHome
      ? "/api/community/lore/export"
      : `/api/community/lore/export?category=${category}`;
  const downloadLabel =
    view === "graph" || isHome
      ? "Download lore pack"
      : downloadLabelForCategory(category);

  const loadCategory = useCallback(
    async (nextCategory: LoreCategoryId, nextSort: LoreSort) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/community/lore?sort=${nextSort}&category=${nextCategory}`
        );
        const data = (await res.json()) as {
          lore?: CommunityLoreListItem[];
          error?: string;
        };
        if (!res.ok && data.error) {
          setError(
            res.status === 503
              ? "The world hall isn’t open yet — check back soon."
              : data.error
          );
        }
        setLore(data.lore || []);
      } catch {
        setError("Could not reach the world hall.");
        setLore([]);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const loadHome = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [trendRes, newRes] = await Promise.all([
        fetch("/api/community/lore?sort=votes"),
        fetch("/api/community/lore?sort=newest"),
      ]);
      const trendData = (await trendRes.json()) as {
        lore?: CommunityLoreListItem[];
        error?: string;
      };
      const newData = (await newRes.json()) as {
        lore?: CommunityLoreListItem[];
        error?: string;
      };
      if ((!trendRes.ok || !newRes.ok) && (trendData.error || newData.error)) {
        setError(
          trendRes.status === 503 || newRes.status === 503
            ? "The world hall isn’t open yet — check back soon."
            : trendData.error || newData.error || "Could not load."
        );
      }
      setTrending((trendData.lore || []).filter((item) => !item.isHub).slice(0, 12));
      setLatest((newData.lore || []).filter((item) => !item.isHub).slice(0, 12));
    } catch {
      setError("Could not reach the world hall.");
      setTrending([]);
      setLatest([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMine = useCallback(async () => {
    if (!isSignedIn) {
      setMine([]);
      return;
    }
    try {
      const res = await fetch("/api/community/lore?mine=1&sort=newest");
      const data = (await res.json()) as { lore?: CommunityLoreListItem[] };
      setMine(
        (data.lore || []).filter(
          (item) => item.status === "pending" || item.status === "denied"
        )
      );
    } catch {
      setMine([]);
    }
  }, [isSignedIn]);

  useEffect(() => {
    setCategory(initialCategory);
    setComposeCategory(initialCategory ?? "characters");
    setView("list");
  }, [initialCategory]);

  useEffect(() => {
    if (view === "graph") return;
    if (isHome) void loadHome();
    else if (category) void loadCategory(category, sort);
  }, [loadHome, loadCategory, category, sort, view, isHome]);

  useEffect(() => {
    void loadMine();
  }, [loadMine]);

  useEffect(() => {
    if (!composeOpen) return;
    void fetch("/api/community/lore?sort=votes")
      .then((r) => r.json())
      .then((data: { lore?: CommunityLoreListItem[] }) => {
        setLinkChoices((data.lore || []).filter((item) => !item.isHub));
      })
      .catch(() => setLinkChoices([]));
  }, [composeOpen]);

  const selectedIds = useMemo(
    () => new Set(links.map((link) => link.toId)),
    [links]
  );

  const filteredChoices = useMemo(() => {
    const q = linkQuery.trim().toLowerCase();
    return linkChoices.filter((item) => {
      if (linkFilter !== "all" && item.category !== linkFilter) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.tags.some((tag) => tag.includes(q)) ||
        loreCategoryMeta(item.category).label.toLowerCase().includes(q)
      );
    });
  }, [linkChoices, linkFilter, linkQuery]);

  const choicesByCategory = useMemo(() => {
    const groups: Array<{
      category: LoreCategoryId;
      label: string;
      items: CommunityLoreListItem[];
    }> = [];
    for (const area of LORE_CATEGORIES) {
      const items = filteredChoices.filter((item) => item.category === area.id);
      if (items.length === 0) continue;
      groups.push({ category: area.id, label: area.label, items });
    }
    return groups;
  }, [filteredChoices]);

  function toggleLink(item: CommunityLoreListItem) {
    setLinks((prev) => {
      if (prev.some((row) => row.toId === item.id)) {
        return prev.filter((row) => row.toId !== item.id);
      }
      return [...prev, { toId: item.id, kind: "related" }];
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
        setError(data.error || "Upload failed — try a smaller JPEG or PNG.");
        setImageUrl(null);
        return;
      }
      setImageUrl(data.url);
    } catch {
      setError("Could not upload that image.");
      setImageUrl(null);
    } finally {
      setUploading(false);
    }
  }

  async function publish(event: React.FormEvent) {
    event.preventDefault();
    if (!isSignedIn) return;
    if (composeCategory === "art" && !imageUrl) {
      setError("Art submissions need an image — pick one above and wait for the preview.");
      return;
    }
    if (composeCategory === "art" && uploading) {
      setError("Still uploading the image — wait a moment, then publish.");
      return;
    }
    setPublishing(true);
    setError(null);
    try {
      const res = await fetch("/api/community/lore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          body,
          summary,
          category: composeCategory,
          locationKey,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          links,
          imageUrl,
        }),
      });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok) {
        setError(data.error || "Could not publish.");
        return;
      }
      setTitle("");
      setSummary("");
      setBody("");
      setLocationKey("");
      setTags("");
      setImageUrl(null);
      setLinks([]);
      setLinkQuery("");
      setComposeOpen(false);
      await loadMine();
      if (isHome) await loadHome();
      else if (category) await loadCategory(category, sort);
      // Jump to the area they just published into so the new card is obvious.
      if (composeCategory && composeCategory !== category) {
        window.location.href = `/world/${composeCategory}`;
        return;
      }
    } finally {
      setPublishing(false);
    }
  }

  async function toggleVote(id: string) {
    if (!isSignedIn) return;
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
    const patch = (list: CommunityLoreListItem[]) =>
      list.map((item) =>
        item.id === id
          ? {
              ...item,
              voteCount: data.voteCount ?? item.voteCount,
              votedByMe: Boolean(data.votedByMe),
            }
          : item
      );
    setLore(patch);
    setTrending(patch);
    setLatest(patch);
  }

  const homeItems = homeFeed === "trending" ? trending : latest;

  return (
    <div className="lore-forum">
      <div className="lore-hall-chrome">
        <nav className="lore-world-nav" aria-label="World areas">
          <Link
            href="/world"
            className={`lore-area-tab${isHome ? " is-active" : ""}`}
          >
            World
          </Link>
          {LORE_CATEGORIES.map((area) => (
            <Link
              key={area.id}
              href={`/world/${area.id}`}
              className={`lore-area-tab${category === area.id ? " is-active" : ""}`}
            >
              {area.label}
            </Link>
          ))}
        </nav>

        {!isHome && activeMeta && (
          <div className="lore-area-banner">
            <div className="lore-area-banner-row">
              <Link className="lore-back-world" href="/world">
                ← World home
              </Link>
            </div>
            <h3>{activeMeta.label}</h3>
            <p>{activeMeta.blurb}</p>
          </div>
        )}

        {header?.({ setLocationKey })}

        <div className="lore-forum-toolbar">
          <div className="lore-view-toggle" role="group" aria-label="Lore view">
            <button
              type="button"
              className={`lore-sort-btn${view === "list" ? " is-active" : ""}`}
              onClick={() => setView("list")}
            >
              Grid
            </button>
            <button
              type="button"
              className={`lore-sort-btn${view === "graph" ? " is-active" : ""}`}
              onClick={() => setView("graph")}
            >
              Graph
            </button>
          </div>

          {view === "list" && isHome && (
            <div className="lore-view-toggle" role="group" aria-label="Home feed">
              <button
                type="button"
                className={`lore-sort-btn${homeFeed === "trending" ? " is-active" : ""}`}
                onClick={() => setHomeFeed("trending")}
              >
                Trending
              </button>
              <button
                type="button"
                className={`lore-sort-btn${homeFeed === "latest" ? " is-active" : ""}`}
                onClick={() => setHomeFeed("latest")}
              >
                Latest
              </button>
            </div>
          )}

          {view === "list" && !isHome && (
            <label className="lore-sort-select">
              <span>Sort</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as LoreSort)}
              >
                {(Object.keys(SORT_LABELS) as LoreSort[]).map((key) => (
                  <option key={key} value={key}>
                    {SORT_LABELS[key]}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="lore-forum-toolbar-right">
            <a className="btn ghost" href={downloadHref}>
              {downloadLabel}
            </a>
            {isLoaded && isSignedIn ? (
              <button
                type="button"
                className="btn primary btn-glow"
                onClick={() => {
                  setComposeCategory(category ?? "characters");
                  setComposeOpen((open) => !open);
                }}
              >
                {composeOpen ? "Close" : "New submission"}
              </button>
            ) : (
              <SignInButton mode="modal">
                <button type="button" className="btn primary btn-glow">
                  Sign in to submit
                </button>
              </SignInButton>
            )}
          </div>
        </div>
      </div>

      {composeOpen && isSignedIn && (
        <form className="lore-compose" onSubmit={publish}>
          <label className="lore-field">
            <span>Area</span>
            <select
              value={composeCategory}
              onChange={(e) =>
                setComposeCategory(e.target.value as LoreCategoryId)
              }
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
              placeholder={`Name this ${composeMeta.label.toLowerCase().replace(/s$/, "")}…`}
              required
            />
          </label>
          <label className="lore-field">
            <span>Summary</span>
            <input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              maxLength={LORE_SUMMARY_MAX}
              placeholder="One-line summary…"
            />
          </label>
          {composeCategory === "art" && (
            <label className="lore-field">
              <span>Image (required)</span>
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
              {!imageUrl && !uploading && (
                <span className="meta">
                  Choose a JPEG, PNG, WebP, or GIF (max 4MB). Wait for the
                  preview before publishing.
                </span>
              )}
            </label>
          )}
          <label className="lore-field">
            <span>{composeCategory === "art" ? "Description" : "Entry"}</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={LORE_BODY_MAX}
              minLength={LORE_BODY_MIN}
              rows={7}
              placeholder={composeMeta.placeholder}
              required
            />
          </label>
          <div className="lore-compose-grid">
            <label className="lore-field">
              <span>Location key</span>
              <input
                value={locationKey}
                onChange={(e) => setLocationKey(e.target.value)}
                placeholder="e.g. barleyhearth"
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
              <span>Tag related</span>
              {links.length > 0 && (
                <span className="meta">{links.length} selected</span>
              )}
            </div>
            <input
              className="lore-link-search"
              value={linkQuery}
              onChange={(e) => setLinkQuery(e.target.value)}
              placeholder="Search characters, places, items…"
              aria-label="Search submissions to tag"
            />
            <div className="lore-link-filters" role="group" aria-label="Filter by area">
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
            {links.length > 0 && (
              <div className="lore-link-selected">
                {links.map((link) => {
                  const item = linkChoices.find((c) => c.id === link.toId);
                  if (!item) return null;
                  return (
                    <button
                      key={link.toId}
                      type="button"
                      className="lore-link-pill is-on"
                      onClick={() => toggleLink(item)}
                    >
                      {loreCategoryMeta(item.category).label}: {item.title} ×
                    </button>
                  );
                })}
              </div>
            )}
            <div className="lore-link-picker">
              {choicesByCategory.length === 0 ? (
                <p className="meta">No matching submissions.</p>
              ) : (
                choicesByCategory.map((group) => (
                  <div key={group.category} className="lore-link-group">
                    <p className="lore-link-group-label">{group.label}</p>
                    <div className="lore-link-options">
                      {group.items.map((item) => {
                        const on = selectedIds.has(item.id);
                        return (
                          <button
                            key={item.id}
                            type="button"
                            className={`lore-link-pill${on ? " is-on" : ""}`}
                            onClick={() => toggleLink(item)}
                            aria-pressed={on}
                          >
                            {item.title}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="lore-compose-actions">
            <p className="meta">
              {body.trim().length}/{LORE_BODY_MAX}
            </p>
            <button
              type="submit"
              className="btn primary"
              disabled={
                publishing ||
                uploading ||
                (composeCategory === "art" && !imageUrl)
              }
            >
              {publishing ? "Publishing…" : "Publish to World"}
            </button>
          </div>
        </form>
      )}

      {error && <p className="lore-error">{error}</p>}

      {mine.length > 0 && (
        <section className="lore-mine">
          <h3>My submissions</h3>
          <ul className="lore-submission-grid lore-submission-grid-compact">
            {mine.map((item) => (
              <li key={item.id} className="lore-submission-card">
                <p className="lore-submission-label">
                  Submission ·{" "}
                  <span className={`lore-status is-${item.status}`}>
                    {item.status}
                  </span>
                </p>
                <Link href={`/world/${item.id}`} className="lore-card-title">
                  {item.title}
                </Link>
                <p className="lore-card-meta">
                  {loreCategoryMeta(item.category).label}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {view === "graph" ? (
        <LoreGraph />
      ) : isHome ? (
        <>
          <section className="lore-home-areas">
            <h3>Areas</h3>
            <ul className="lore-area-cards">
              {LORE_CATEGORIES.map((area) => (
                <li key={area.id}>
                  <Link href={`/world/${area.id}`} className="lore-area-card">
                    <strong>{area.label}</strong>
                    <span>{area.blurb}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          {loading ? (
            <p className="lore-empty">Unfurling the scrolls…</p>
          ) : homeItems.length === 0 ? (
            <div className="lore-empty-card">
              <h3>No submissions yet</h3>
              <p>Be the first to publish something for the valley.</p>
            </div>
          ) : (
            <section className="lore-home-feed">
              <h3>{homeFeed === "trending" ? "Trending" : "Latest"}</h3>
              <ul className="lore-submission-grid">
                {homeItems.map((item) => (
                  <SubmissionCard
                    key={item.id}
                    item={item}
                    isSignedIn={Boolean(isSignedIn)}
                    onVote={toggleVote}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
      ) : loading ? (
        <p className="lore-empty">Unfurling the scrolls…</p>
      ) : lore.length === 0 ? (
        <div className="lore-empty-card">
          <h3>No {activeMeta?.label.toLowerCase()} yet</h3>
          <p>Be the first to publish something in this area.</p>
        </div>
      ) : (
        <ul className="lore-submission-grid">
          {lore.map((item) => (
            <SubmissionCard
              key={item.id}
              item={item}
              isSignedIn={Boolean(isSignedIn)}
              onVote={toggleVote}
            />
          ))}
        </ul>
      )}

      <div className="lore-socials">
        <CommunityLinks />
      </div>
    </div>
  );
}
