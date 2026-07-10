"use client";

import { useCallback, useEffect, useState } from "react";
import AdminNav from "./AdminNav";
import ArbitrageGraph from "./ArbitrageGraph";
import Web3CommandCenter from "./Web3CommandCenter";
import CampaignWatch from "./CampaignWatch";
import CatNftShop from "./CatNftShop";
import MusicNftShop from "./MusicNftShop";
import type { Web3Hub } from "@/lib/web3-dashboard";

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
    lastPlanReason?: string | null;
    ok: boolean | null;
    canPost: boolean;
    canComment: boolean;
    upvotesRemaining: number;
    inQuietHours: boolean;
    heartbeatStale?: boolean;
    brainBlocked?: boolean;
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
      actorName?: string;
      displayTitle?: string;
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
  trading?: {
    enabled: boolean;
    hasSigner: boolean;
    log: {
      id: string;
      timestamp: string;
      chain?: string;
      action: string;
      inputMint: string;
      outputMint: string;
      inputAmount: string;
      outputAmount?: string;
      signature?: string;
      dryRun: boolean;
      error?: string;
    }[];
  };
  onchainEvents?: {
    id: string;
    timestamp: string;
    type: string;
    network?: string;
    summary: string;
  }[];
  web3Hub?: Web3Hub;
  campaign?: {
    id: string;
    name: string;
    ticker: string;
    status: string;
    steps: {
      id: string;
      submolt: string;
      label: string;
      title: string;
      status: string;
      postUrl?: string;
      postedAt?: string;
      error?: string;
    }[];
    events: {
      id: string;
      timestamp: string;
      type: string;
      message: string;
      postUrl?: string;
    }[];
    startedAt?: string;
    completedAt?: string;
  };
  campaignPersisted?: boolean;
  campaignError?: string;
  catNftShop?: {
    gallery: string;
    api: string;
    stats: { total: number; listed: number; sold: number; reserved: number };
    catalog: {
      id: string;
      tokenId: number;
      name: string;
      traits: { fur: string; eyes: string; accessory: string; vibe: string };
      status: string;
      priceUsdc: number;
      imageSvg: string;
      buyerAgentName?: string;
    }[];
  };
  musicNftShop?: {
    gallery?: string;
    api?: string;
    live?: boolean;
    priceUsdc?: number;
    sunoCredits?: number | null;
    contractConfigured?: boolean;
    minterConfigured?: boolean;
    stats?: { total: number; minted: number; generating: number; failed: number };
    orders?: Array<{
      id: string;
      status: string;
      buyerAgentName: string;
      title?: string;
      tokenId?: number;
      error?: string;
      createdAt: string;
    }>;
    campaign?: {
      ticker: string;
      status: string;
      steps?: Array<{ id: string; label: string; status: string; postUrl?: string }>;
    };
  };
  llm?: {
    configured: string[];
    primary: string;
    mode: string;
    aiiUrl?: string;
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
  const [heartbeatRunning, setHeartbeatRunning] = useState(false);
  const [predTickBusy, setPredTickBusy] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [xStatus, setXStatus] = useState<{
    connected?: boolean;
    username?: string;
    configured?: boolean;
    callbackUrl?: string;
  } | null>(null);

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

  useEffect(() => {
    void fetch("/api/auth/x/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setXStatus(data);
      })
      .catch(() => undefined);

    const params = new URLSearchParams(window.location.search);
    const connected = params.get("x_connected");
    const xErr = params.get("x_error");
    if (connected) {
      setError("");
      window.history.replaceState({}, "", "/admin");
    } else if (xErr) {
      setError(`X connect failed: ${xErr}`);
      window.history.replaceState({}, "", "/admin");
    }
  }, []);

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    window.location.href = "/admin/login";
  }

  async function runHeartbeatNow() {
    setHeartbeatRunning(true);
    try {
      const res = await fetch("/api/admin/heartbeat", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "heartbeat_failed");
      await fetchState();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Heartbeat failed");
    } finally {
      setHeartbeatRunning(false);
    }
  }

  async function setMoltbookAvatar() {
    setAvatarBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/avatar", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(
          data.error ?? data.hint ?? "Avatar upload failed",
        );
      }
      await fetchState();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Avatar upload failed");
    } finally {
      setAvatarBusy(false);
    }
  }

  async function runPredictionTickNow() {
    setPredTickBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/prediction-tick", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        throw new Error(data.error ?? "prediction_tick_failed");
      }
      await fetchState();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Prediction tick failed");
    } finally {
      setPredTickBusy(false);
    }
  }

  const online =
    state?.status.lastTickAt &&
    !state?.status.heartbeatStale &&
    Date.now() - new Date(state.status.lastTickAt).getTime() < 45 * 60 * 1000;

  const mb = state?.moltbook;
  const profile = mb?.profile;

  return (
    <div className="admin-shell dashboard">
      <header className="admin-topbar">
        <div className="admin-brand">
          <h1>Punaab</h1>
          <span className="admin-brand-sub">command</span>
        </div>
        <div className="admin-topbar-actions">
          <div className="pulse pulse-compact">
            <span className={`pulse-dot ${online ? "" : "offline"}`} />
            {online ? "LIVE" : "STALE"}
          </div>
          <button
            type="button"
            className="btn-compact"
            disabled={heartbeatRunning}
            onClick={() => void runHeartbeatNow()}
          >
            {heartbeatRunning ? "…" : "Heartbeat"}
          </button>
          <button
            type="button"
            className="btn-compact"
            disabled={predTickBusy}
            onClick={() => void runPredictionTickNow()}
            title="Run one Jupiter Forecast prediction tick now"
          >
            {predTickBusy ? "…" : "Pred tick"}
          </button>
          <button
            type="button"
            className="btn-compact"
            disabled={avatarBusy}
            onClick={() => void setMoltbookAvatar()}
            title="Upload public/punaab-avatar.png to Moltbook"
          >
            {avatarBusy ? "…" : "Set PFP"}
          </button>
          <a
            className="btn-compact"
            href="/api/auth/x/start"
            title={
              xStatus?.connected
                ? `Connected as @${xStatus.username ?? "x"}`
                : `Connect @notbitcoinceo — callback ${xStatus?.callbackUrl ?? ""}`
            }
          >
            {xStatus?.connected
              ? `X @${xStatus.username ?? "ok"}`
              : "Connect X"}
          </a>
          <button type="button" className="btn-compact btn-compact-ghost" onClick={logout}>
            Out
          </button>
        </div>
      </header>

      <AdminNav
        online={Boolean(online)}
        karma={profile?.karma}
        unread={mb?.unreadCount}
      />

      {(state?.status.brainBlocked ||
        state?.status.heartbeatStale ||
        error ||
        mb?.error) && (
        <div className="admin-alerts">
          {state?.status.brainBlocked && (
            <p className="login-error admin-alert">
              Brain blocked: {state.status.lastPlanReason?.includes("anthropic_credits")
                ? "LLM credits exhausted."
                : state.status.lastPlanReason?.includes("no_llm_provider")
                  ? "No LLM configured."
                  : state.status.lastPlanReason ?? "brain_error"}
            </p>
          )}
          {state?.status.heartbeatStale && !state?.status.brainBlocked && (
            <p className="login-error admin-alert">
              Heartbeat stale — use Heartbeat or fix cron secrets.
            </p>
          )}
          {error && <p className="login-error admin-alert">{error}</p>}
          {mb?.error && <p className="login-error admin-alert">Moltbook: {mb.error}</p>}
        </div>
      )}

      <section id="admin-arb" className="admin-section">
        <ArbitrageGraph
          prediction={state?.web3Hub?.prediction}
          hubBalances={state?.web3Hub?.snapshot?.balances}
        />
      </section>

      <section id="admin-agent" className="admin-section">
      {/* Moltbook hero — compact */}
      <section className="moltbook-hero panel panel-wide admin-compact-panel">
        <div className="hero-profile">
          <div className="avatar-wrap">
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt={profile.name}
                className="avatar"
              />
            ) : (
              <img
                src="/punaab-avatar.png"
                alt={profile?.name ?? "punaab"}
                className="avatar"
              />
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
          <div className="stat-card">
            <span className="stat-value">{state?.llm?.primary ?? "—"}</span>
            <span className="stat-label">LLM ({state?.llm?.mode ?? "auto"})</span>
          </div>
        </div>
      </section>

      {/* Punaab built apps/games */}
      <section className="panel panel-wide built-section admin-compact-panel">
        <h2>Built</h2>
        <p className="muted section-hint admin-hint-compact">
          Apps & tools punaab publishes
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

      <div className="grid layout-main admin-main-grid">
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
                  <span className="notif-type">
                    {n.displayTitle ?? n.type ?? "alert"}
                  </span>
                  <p>{n.message ?? n.preview}</p>
                  {n.actorName && n.type === "new_follower" && (
                    <a
                      href={`https://www.moltbook.com/u/${n.actorName}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="notif-link"
                    >
                      View @{n.actorName}
                    </a>
                  )}
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
      </section>

      <section id="admin-web3" className="admin-section">
        <Web3CommandCenter hub={state?.web3Hub} onRefresh={fetchState} />
      </section>

      <section id="admin-campaign" className="admin-section">
        <CampaignWatch
          campaign={state?.campaign}
          campaignPersisted={state?.campaignPersisted}
          campaignError={state?.campaignError}
          onRefresh={fetchState}
        />
      </section>

      <section id="admin-nfts" className="admin-section admin-nfts-grid">
        <CatNftShop data={state?.catNftShop} onRefresh={fetchState} />
        <MusicNftShop data={state?.musicNftShop} onRefresh={fetchState} />
      </section>

      <section id="admin-logs" className="admin-section">
      <section className="panel panel-wide heartbeat-log admin-compact-panel">
        <h2>Heartbeat Log</h2>
        <ul className="activity-list">
          {state?.tickLog?.map((tick, i) => (
            <li key={`${tick.timestamp}-${i}`}>
              <div className="activity-time">{formatTime(tick.timestamp)}</div>
              <span className="activity-action">{tick.plan.action}</span>
              {tick.plan.reason && (
                <span className="muted"> — {tick.plan.reason}</span>
              )}
              {tick.executed?.length ? (
                <div className="muted">{tick.executed.join(", ")}</div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      </section>
    </div>
  );
}
