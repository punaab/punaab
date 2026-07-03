"use client";

import { useCallback, useEffect, useState } from "react";

interface CampaignStep {
  id: string;
  submolt: string;
  label: string;
  title: string;
  status: string;
  postUrl?: string;
  postedAt?: string;
  error?: string;
}

interface CampaignEvent {
  id: string;
  timestamp: string;
  type: string;
  message: string;
  postUrl?: string;
}

interface Campaign {
  id: string;
  name: string;
  ticker: string;
  status: string;
  steps: CampaignStep[];
  events: CampaignEvent[];
  startedAt?: string;
  completedAt?: string;
}

function timeAgo(iso: string | undefined): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function stepIcon(status: string): string {
  if (status === "posted") return "✓";
  if (status === "failed") return "✗";
  if (status === "skipped") return "—";
  return "○";
}

interface Props {
  campaign: Campaign | null | undefined;
  onRefresh: () => void;
}

export default function CampaignWatch({ campaign, onRefresh }: Props) {
  const [local, setLocal] = useState<Campaign | null | undefined>(campaign);
  const [busy, setBusy] = useState(false);
  const [heartbeatBusy, setHeartbeatBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [lastHeartbeat, setLastHeartbeat] = useState<Record<string, unknown> | null>(
    null,
  );

  useEffect(() => {
    setLocal(campaign);
  }, [campaign]);

  const runAction = useCallback(
    async (action: "start" | "pause" | "reset") => {
      setBusy(true);
      setError("");
      setSuccess("");
      try {
        const res = await fetch("/api/admin/campaign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const data = (await res.json()) as {
          error?: string;
          campaign?: Campaign;
          ok?: boolean;
        };
        if (!res.ok || !data.ok) {
          setError(data.error ?? "Action failed");
          return;
        }
        if (data.campaign) {
          setLocal(data.campaign);
          if (action === "start") {
            setSuccess(
              "Campaign is active. Click “Run heartbeat now” to post the first step (if rate limits allow).",
            );
          } else if (action === "reset") {
            setSuccess("Campaign reset to draft.");
          } else {
            setSuccess("Campaign paused.");
          }
        }
        onRefresh();
      } catch {
        setError("Could not reach campaign API — check you are logged in.");
      } finally {
        setBusy(false);
      }
    },
    [onRefresh],
  );

  async function runHeartbeat() {
    setHeartbeatBusy(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/admin/heartbeat", { method: "POST" });
      const data = (await res.json()) as Record<string, unknown> & { error?: string };
      setLastHeartbeat(data);
      if (!res.ok) {
        setError(String(data.error ?? "Heartbeat failed"));
        return;
      }
      const executed = Array.isArray(data.executed) ? data.executed.join(", ") : "";
      const plan = data.plan as { action?: string; reason?: string } | undefined;
      if (executed.includes("campaign_posted")) {
        setSuccess(`Posted a campaign step: ${executed}`);
      } else if (plan?.action === "comment") {
        setSuccess(
          "Heartbeat ran — replied to notifications first (campaign posts after unread notifications are clear).",
        );
      } else if (data.canPost === false) {
        setSuccess(
          "Heartbeat ran — post blocked by rate limit (~4h between posts). Try again later.",
        );
      } else {
        setSuccess(`Heartbeat ran: ${plan?.action ?? "tick"} ${executed ? `(${executed})` : ""}`);
      }
      onRefresh();
    } catch {
      setError("Could not trigger heartbeat.");
    } finally {
      setHeartbeatBusy(false);
    }
  }

  const c = local;
  const posted = c?.steps.filter((s) => s.status === "posted").length ?? 0;
  const total = c?.steps.length ?? 3;
  const percent = total ? Math.round((posted / total) * 100) : 0;
  const isActive = c?.status === "active";
  const isComplete = c?.status === "complete";
  const isPaused = c?.status === "paused";

  return (
    <section className="campaign-watch panel panel-wide">
      <header className="campaign-header">
        <div>
          <p className="campaign-eyebrow">Moltbook distribution</p>
          <h2 className="campaign-title">$GITLAWB Campaign</h2>
          <p className="muted campaign-subtitle">
            m/agents → vision · m/crypto → chart · m/tooling → install
          </p>
        </div>
        <div className="campaign-actions">
          {!isActive && !isComplete && (
            <button
              type="button"
              className="btn-moltbook campaign-btn-start"
              disabled={busy}
              onClick={() => void runAction("start")}
            >
              {busy ? "Starting…" : "Launch campaign"}
            </button>
          )}
          {isActive && (
            <button
              type="button"
              className="btn-ghost"
              disabled={busy}
              onClick={() => void runAction("pause")}
            >
              Pause
            </button>
          )}
          {isPaused && (
            <button
              type="button"
              className="btn-moltbook campaign-btn-start"
              disabled={busy}
              onClick={() => void runAction("start")}
            >
              Resume
            </button>
          )}
          <button
            type="button"
            className="btn-ghost"
            disabled={heartbeatBusy || !isActive}
            onClick={() => void runHeartbeat()}
            title={isActive ? "Trigger one heartbeat tick now" : "Launch campaign first"}
          >
            {heartbeatBusy ? "Running…" : "Run heartbeat now"}
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={() => void runAction("reset")}
          >
            Reset
          </button>
        </div>
      </header>

      {success && <p className="campaign-success">{success}</p>}
      {error && <p className="login-error campaign-error">{error}</p>}

      {isActive && (
        <p className="campaign-active-banner">
          ● CAMPAIGN ACTIVE — status: {c?.status} · started{" "}
          {c?.startedAt ? timeAgo(c.startedAt) : "just now"}
        </p>
      )}

      <div className="campaign-progress-wrap">
        <div className="campaign-progress-bar">
          <div
            className="campaign-progress-fill"
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="campaign-progress-label">
          {posted}/{total} posted · {c?.status ?? "draft"}
        </span>
      </div>

      {!c?.steps?.length && (
        <p className="muted campaign-checklist">
          Loading campaign steps… If this persists, Redis/KV may be missing on Vercel.
        </p>
      )}

      <div className="campaign-steps">
        {(c?.steps ?? []).map((step, i) => (
          <div
            key={step.id}
            className={`campaign-step campaign-step-${step.status}`}
          >
            <div className="campaign-step-num">{i + 1}</div>
            <div className="campaign-step-body">
              <div className="campaign-step-top">
                <span className="campaign-step-icon">{stepIcon(step.status)}</span>
                <span className="submolt-tag">m/{step.submolt}</span>
                <span className="campaign-step-label">{step.label}</span>
                <span className={`campaign-step-status status-${step.status}`}>
                  {step.status}
                </span>
              </div>
              <p className="campaign-step-title">{step.title}</p>
              {step.postUrl && (
                <a
                  href={step.postUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="campaign-post-link"
                >
                  View on Moltbook →
                </a>
              )}
              {step.postedAt && (
                <span className="activity-time">Posted {timeAgo(step.postedAt)}</span>
              )}
              {step.error && <p className="login-error">{step.error}</p>}
            </div>
          </div>
        ))}
      </div>

      <div className="campaign-events">
        <h3 className="campaign-events-title">Distribution log</h3>
        {!c?.events?.length && (
          <p className="muted">Launch the campaign to start watching distribution.</p>
        )}
        <ul className="campaign-event-list">
          {c?.events?.slice(0, 12).map((e) => (
            <li key={e.id} className="campaign-event-item">
              <span className="campaign-event-type">{e.type}</span>
              <span>{e.message}</span>
              {e.postUrl && (
                <a
                  href={e.postUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="campaign-post-link"
                >
                  open
                </a>
              )}
              <span className="activity-time">{timeAgo(e.timestamp)}</span>
            </li>
          ))}
        </ul>
      </div>

      {lastHeartbeat && (
        <details className="campaign-heartbeat-debug">
          <summary className="muted">Last heartbeat response</summary>
          <pre>{JSON.stringify(lastHeartbeat, null, 2)}</pre>
        </details>
      )}

      <div className="campaign-checklist muted">
        <strong>Before distribution works, you need:</strong>
        <ul>
          <li>
            <strong>Redis/KV</strong> on Vercel (
            <code>UPSTASH_REDIS_REST_URL</code> + token) — stores campaign state
          </li>
          <li>
            <strong>CRON_SECRET</strong> on Vercel — enables “Run heartbeat now” and cron
          </li>
          <li>
            <strong>MOLTBOOK_API_KEY</strong> — agent can post to m/agents, m/crypto,
            m/tooling
          </li>
          <li>
            Launch only <em>arms</em> the campaign — posts run on heartbeat (~30 min cron),
            not instantly
          </li>
          <li>
            Unread notifications are handled first; campaign posts when notifications are
            clear and ~4h post limit allows
          </li>
        </ul>
      </div>
    </section>
  );
}
