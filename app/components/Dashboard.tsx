"use client";

import { useCallback, useEffect, useState } from "react";

interface MoltbookProfile {
  name: string;
  description?: string;
  karma?: number;
  avatar_url?: string | null;
  is_claimed?: boolean;
  follower_count?: number;
  following_count?: number;
  stats?: { posts?: number; comments?: number };
  owner?: { x_handle?: string; x_verified?: boolean };
  recentPosts?: {
    id: string;
    title?: string;
    content?: string;
    submolt_name?: string;
    upvotes?: number;
    comment_count?: number;
    created_at?: string;
  }[];
  recentComments?: {
    id?: string;
    content?: string;
    post_id?: string;
    created_at?: string;
    upvotes?: number;
  }[];
}

interface AdminState {
  agent: { name: string; handle: string };
  status: {
    lastTickAt: string | null;
    lastAction: string | null;
    ok: boolean | null;
    canPost: boolean;
    canComment: boolean;
    upvotesRemaining: number;
    inQuietHours: boolean;
  };
  thought: string | null;
  plans: { id: string; text: string; createdAt: string; status: string }[];
  tickLog: {
    timestamp: string;
    plan: { action: string; reason?: string };
    executed: string[];
    errors: string[];
  }[];
  activity: {
    id: string;
    timestamp: string;
    action: string;
    summary?: string;
    content?: string;
    targetId?: string;
    targetUrl?: string;
    reason?: string;
  }[];
  usage: {
    postsThisHour: number;
    postsToday: number;
    commentsThisHour: number;
    commentsToday: number;
    upvotesThisHour: number;
    upvotesToday: number;
  };
  apps: { slug: string; title: string; kind: string; url: string; updatedAt: string }[];
  collab: {
    id: string;
    fromAgentName: string;
    message: string;
    createdAt: string;
    karma?: number;
  }[];
  web3: {
    capturedAt: string;
    summary: string;
    balances: { chain: string; address: string; balance: string; symbol: string }[];
  } | null;
  shortTermGoals?: string[];
  publishedLinks?: {
    id: string;
    title: string;
    url: string;
    kind: string;
    createdAt: string;
    note?: string;
  }[];
  moltbook: {
    profile: MoltbookProfile | null;
    profileUrl: string;
    notifications: {
      id?: string;
      type?: string;
      message?: string;
      preview?: string;
      post_id?: string;
      created_at?: string;
      read?: boolean;
    }[];
    unreadCount: number;
    feedPreview: {
      id: string;
      title?: string;
      content?: string;
      submolt_name?: string;
      author_name?: string;
      upvotes?: number;
      comment_count?: number;
      created_at?: string;
    }[];
    error?: string;
  };
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function postUrl(id: string): string {
  return `https://www.moltbook.com/post/${id}`;
}

export default function Dashboard() {
  const [state, setState] = useState<AdminState | null>(null);
  const [error, setError] = useState("");

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/state");
      if (!res.ok) throw new Error("unauthorized");
      setState(await res.json());
      setError("");
    } catch {
      setError("Failed to load state");
    }
  }, []);

  useEffect(() => {
    fetchState();
    const id = setInterval(fetchState, 30_000);
    return () => clearInterval(id);
  }, [fetchState]);

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const online =
    state?.status.lastTickAt &&
    Date.now() - new Date(state.status.lastTickAt).getTime() < 45 * 60 * 1000;

  const mb = state?.moltbook;
  const profile = mb?.profile;

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div>
          <h1>Punaab Command</h1>
          <p className="subtitle">Owner dashboard · Moltbook agent operations</p>
        </div>
        <div className="header-actions">
          <div className="pulse">
            <span className={`pulse-dot ${online ? "" : "offline"}`} />
            {online ? "HEARTBEAT LIVE" : "HEARTBEAT STALE"}
          </div>
          <button type="button" className="btn-ghost" onClick={logout}>
            Logout
          </button>
        </div>
      </header>

      {error && <p className="login-error">{error}</p>}
      {mb?.error && (
        <p className="login-error">Moltbook: {mb.error}</p>
      )}

      {/* Moltbook hero */}
      <section className="moltbook-hero panel panel-wide">
        <div className="hero-profile">
          <div className="avatar-wrap">
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt={profile.name}
                className="avatar"
              />
            ) : (
              <div className="avatar avatar-placeholder">P</div>
            )}
            {profile?.is_claimed && (
              <span className="claimed-badge" title="Claimed agent">✓</span>
            )}
          </div>
          <div className="hero-info">
            <div className="hero-name-row">
              <h2 className="hero-name">u/{profile?.name ?? "punaab"}</h2>
              <a
                href={mb?.profileUrl ?? "https://www.moltbook.com/u/punaab"}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-moltbook"
              >
                Open on Moltbook →
              </a>
            </div>
            <p className="hero-bio">
              {profile?.description ?? "Faithful agent on Moltbook."}
            </p>
            {profile?.owner?.x_handle && (
              <p className="muted">
                Owner: @{profile.owner.x_handle}
                {profile.owner.x_verified ? " ✓" : ""}
              </p>
            )}
          </div>
        </div>
        <div className="hero-stats">
          <div className="stat-card">
            <span className="stat-value">{profile?.karma ?? "—"}</span>
            <span className="stat-label">Karma</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{profile?.stats?.posts ?? "—"}</span>
            <span className="stat-label">Posts</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{profile?.stats?.comments ?? "—"}</span>
            <span className="stat-label">Comments</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{profile?.follower_count ?? "—"}</span>
            <span className="stat-label">Followers</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{mb?.unreadCount ?? 0}</span>
            <span className="stat-label">Unread</span>
          </div>
        </div>
      </section>

      {/* Punaab built apps/games — always surfaced here */}
      <section className="panel panel-wide built-section">
        <h2>Punaab Built</h2>
        <p className="muted section-hint">
          Apps, games, and tools punaab publishes — links appear here automatically
        </p>
        {!state?.publishedLinks?.length && !state?.apps?.length && (
          <p className="muted">Nothing built yet.</p>
        )}
        <div className="built-grid">
          {(state?.publishedLinks ?? []).map((link) => (
            <a
              key={link.id}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="built-card"
            >
              <span className="built-kind">{link.kind}</span>
              <span className="built-title">{link.title}</span>
              {link.note && <span className="built-note">{link.note}</span>}
              <span className="activity-time">{timeAgo(link.createdAt)}</span>
            </a>
          ))}
          {(state?.apps ?? [])
            .filter(
              (a) =>
                !(state?.publishedLinks ?? []).some((l) => l.url.includes(a.slug)),
            )
            .map((a) => (
              <a
                key={a.slug}
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="built-card"
              >
                <span className="built-kind">{a.kind}</span>
                <span className="built-title">{a.title}</span>
                <span className="activity-time">{timeAgo(a.updatedAt)}</span>
              </a>
            ))}
        </div>
      </section>

      <div className="grid layout-main">
        {/* Left column — Moltbook activity */}
        <div className="column-moltbook">
          <section className="panel panel-activity">
            <h2>Live Activity</h2>
            <p className="muted section-hint">
              What punaab actually did — updates immediately after each heartbeat
            </p>
            {!state?.activity?.length && (
              <p className="muted">No actions logged yet. Trigger a heartbeat or wait for cron.</p>
            )}
            <div className="activity-feed">
              {state?.activity?.map((a) => (
                <article key={a.id} className={`activity-item activity-${a.action}`}>
                  <div className="activity-item-header">
                    <span className="activity-action">{a.action}</span>
                    <span className="activity-time">{timeAgo(a.timestamp)}</span>
                  </div>
                  {a.summary && a.action === "post" && (
                    <h3 className="activity-title">{a.summary}</h3>
                  )}
                  {a.content && (
                    <p className="activity-body">{a.content.slice(0, 320)}</p>
                  )}
                  {a.summary && a.action !== "post" && !a.content && (
                    <p className="activity-body">{a.summary}</p>
                  )}
                  {a.reason && (
                    <p className="activity-reason muted">{a.reason.slice(0, 200)}</p>
                  )}
                  {a.targetUrl && (
                    <a
                      href={a.targetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="activity-link"
                    >
                      View on Moltbook →
                    </a>
                  )}
                </article>
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>Punaab&apos;s Posts</h2>
            {!profile?.recentPosts?.length && (
              <p className="muted">No recent posts yet.</p>
            )}
            <div className="post-cards">
              {profile?.recentPosts?.map((post) => (
                <article key={post.id} className="post-card">
                  <div className="post-meta">
                    <span className="submolt-tag">
                      m/{post.submolt_name ?? "general"}
                    </span>
                    <span className="activity-time">
                      {timeAgo(post.created_at)}
                    </span>
                  </div>
                  <h3 className="post-title">
                    <a
                      href={postUrl(post.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {post.title ?? "Untitled"}
                    </a>
                  </h3>
                  {post.content && (
                    <p className="post-preview">{post.content.slice(0, 200)}</p>
                  )}
                  <div className="post-stats">
                    <span>▲ {post.upvotes ?? 0}</span>
                    <span>💬 {post.comment_count ?? 0}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>Recent Comments (Moltbook API)</h2>
            <p className="muted section-hint">
              From Moltbook profile — may lag behind Live Activity
            </p>
            {!profile?.recentComments?.length && (
              <p className="muted">No recent comments yet.</p>
            )}
            <div className="comment-list">
              {profile?.recentComments?.map((c, i) => (
                <div key={c.id ?? i} className="comment-card">
                  <p className="comment-body">
                    {String(c.content ?? "").slice(0, 240)}
                  </p>
                  <div className="comment-meta">
                    {c.post_id && (
                      <a
                        href={postUrl(c.post_id)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View thread
                      </a>
                    )}
                    <span className="activity-time">
                      {timeAgo(c.created_at)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>Feed Preview</h2>
            <p className="muted section-hint">
              What punaab sees on the next heartbeat
            </p>
            {!mb?.feedPreview?.length && (
              <p className="muted">Feed empty or unavailable.</p>
            )}
            <div className="feed-list">
              {mb?.feedPreview?.map((post) => {
                const isPunaab =
                  post.author_name?.toLowerCase() === "punaab";
                return (
                  <div
                    key={post.id}
                    className={`feed-item ${isPunaab ? "feed-item-own" : ""}`}
                  >
                    <div className="feed-item-header">
                      <span className="submolt-tag">
                        m/{post.submolt_name ?? "?"}
                      </span>
                      <span className={isPunaab ? "author-own" : "author"}>
                        u/{post.author_name ?? "unknown"}
                      </span>
                      <span className="activity-time">
                        {timeAgo(post.created_at)}
                      </span>
                    </div>
                    <a
                      href={postUrl(post.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="feed-title"
                    >
                      {post.title ?? post.content?.slice(0, 80) ?? "Post"}
                    </a>
                    <div className="post-stats">
                      <span>▲ {post.upvotes ?? 0}</span>
                      <span>💬 {post.comment_count ?? 0}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* Right column — agent mind + ops */}
        <div className="column-ops">
          <section className="panel">
            <h2>Current Thought</h2>
            <p className="thought-text">
              {state?.thought ?? "Awaiting first heartbeat…"}
            </p>
          </section>

          <section className="panel">
            <h2>Notifications</h2>
            {!mb?.notifications?.length && (
              <p className="muted">No notifications.</p>
            )}
            <ul className="notif-list">
              {mb?.notifications?.map((n, i) => (
                <li
                  key={n.id ?? i}
                  className={n.read ? "notif-read" : "notif-unread"}
                >
                  <span className="notif-type">{n.type ?? "alert"}</span>
                  <p>{n.message ?? n.preview}</p>
                  {n.post_id && (
                    <a
                      href={postUrl(n.post_id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="notif-link"
                    >
                      Open post
                    </a>
                  )}
                  <span className="activity-time">
                    {timeAgo(n.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel">
            <h2>Short-Term Goals</h2>
            <ul className="goals-list">
              {(state?.shortTermGoals ?? state?.plans ?? []).map((g, i) => (
                <li key={typeof g === "string" ? i : g.id}>
                  {typeof g === "string" ? g : g.text}
                </li>
              ))}
            </ul>
          </section>

          <section className="panel">
            <h2>Agent Status</h2>
            <div className="meter-row">
              <span>Last tick</span>
              <span className="activity-time">
                {formatTime(state?.status.lastTickAt ?? null)}
              </span>
            </div>
            <div className="meter-row">
              <span>Last action</span>
              <span className="activity-action">
                {state?.status.lastAction ?? "—"}
              </span>
            </div>
            <div className="meter-row">
              <span>Can post / comment</span>
              <span>
                {state?.status.canPost ? "post ✓" : "post ✗"} ·{" "}
                {state?.status.canComment ? "comment ✓" : "comment ✗"}
              </span>
            </div>
            <div className="meter-row">
              <span>Upvotes left</span>
              <span>{state?.status.upvotesRemaining ?? 0}</span>
            </div>
            <div className="usage-bars">
              <div className="usage-bar-item">
                <span>Posts today</span>
                <div className="meter-bar">
                  <div
                    className="meter-fill"
                    style={{
                      width: `${Math.min(100, (state?.usage.postsToday ?? 0) * 33)}%`,
                    }}
                  />
                </div>
              </div>
              <div className="usage-bar-item">
                <span>Comments today</span>
                <div className="meter-bar">
                  <div
                    className="meter-fill"
                    style={{
                      width: `${Math.min(100, (state?.usage.commentsToday ?? 0) * 10)}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="panel">
            <h2>Plans</h2>
            {!state?.plans?.length && (
              <p className="muted">No active plans.</p>
            )}
            {state?.plans?.map((p) => (
              <div key={p.id} className="plan-item">
                {p.text}
                <div className="activity-time">{formatTime(p.createdAt)}</div>
              </div>
            ))}
          </section>

          {state?.web3 && (
            <section className="panel">
              <h2>Wallets</h2>
              {state.web3.balances.map((b) => (
                <div key={`${b.chain}-${b.address}`} className="meter-row">
                  <span className="collab-from">{b.chain}</span>
                  <span>
                    {b.balance} {b.symbol}
                  </span>
                </div>
              ))}
            </section>
          )}

          <section className="panel">
            <h2>Collab Inbox</h2>
            {!state?.collab?.length && (
              <p className="muted">No bot proposals.</p>
            )}
            {state?.collab?.map((c) => (
              <div key={c.id} className="collab-item">
                <div className="collab-from">{c.fromAgentName}</div>
                <p>{c.message}</p>
              </div>
            ))}
          </section>
        </div>
      </div>

      <section className="panel panel-wide heartbeat-log">
        <h2>Heartbeat Log</h2>
        <ul className="activity-list">
          {state?.tickLog?.map((tick, i) => (
            <li key={`${tick.timestamp}-${i}`}>
              <div className="activity-time">{formatTime(tick.timestamp)}</div>
              <span className="activity-action">{tick.plan.action}</span>
              {tick.plan.reason && (
                <span className="muted"> — {tick.plan.reason}</span>
              )}
              {tick.executed.length > 0 && (
                <div className="muted">{tick.executed.join(", ")}</div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
