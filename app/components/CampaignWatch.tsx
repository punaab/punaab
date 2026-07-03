"use client";

import { useCallback, useState } from "react";

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const runAction = useCallback(
    async (action: "start" | "pause" | "reset") => {
      setBusy(true);
      setError("");
      try {
        const res = await fetch("/api/admin/campaign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          setError(data.error ?? "Action failed");
          return;
        }
        onRefresh();
      } catch {
        setError("Could not reach campaign API");
      } finally {
        setBusy(false);
      }
    },
    [onRefresh],
  );

  const c = campaign;
  const posted = c?.steps.filter((s) => s.status === "posted").length ?? 0;
  const total = c?.steps.length ?? 3;
  const percent = total ? Math.round((posted / total) * 100) : 0;
  const isActive = c?.status === "active";
  const isComplete = c?.status === "complete";

  return (
    <section className="campaign-watch panel panel-wide">
      <header className="campaign-header">
        <div>
          <p className="campaign-eyebrow">Moltbook distribution</p>
          <h2 className="campaign-title">$GITLAWB Campaign</h2>
          <p className="muted campaign-subtitle">
            m/agents → vision · m/crypto → chart · m/tooling → install — one post per
            heartbeat when rate limits allow
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

      {error && <p className="login-error">{error}</p>}

      <p className="muted campaign-footer">
        Notifications still come first each heartbeat. Campaign posts fire on the next
        eligible tick (~4h between posts). Dashboard refreshes every 30s.
      </p>
    </section>
  );
}
