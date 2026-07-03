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

function statusLabel(status: string | undefined): string {
  switch (status) {
    case "active":
      return "RUNNING";
    case "paused":
      return "PAUSED";
    case "complete":
      return "COMPLETE";
    default:
      return "DRAFT";
  }
}

interface Props {
  campaign: Campaign | null | undefined;
  campaignPersisted?: boolean;
  campaignError?: string;
  onRefresh: () => void;
}

export default function CampaignWatch({
  campaign,
  campaignPersisted,
  campaignError,
  onRefresh,
}: Props) {
  const [local, setLocal] = useState<Campaign | null | undefined>(campaign);
  const [persisted, setPersisted] = useState(campaignPersisted ?? true);
  const [persistError, setPersistError] = useState(campaignError);
  const [busy, setBusy] = useState(false);
  const [heartbeatBusy, setHeartbeatBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [lastHeartbeat, setLastHeartbeat] = useState<Record<string, unknown> | null>(
    null,
  );

  const refreshCampaign = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/campaign");
      if (!res.ok) return;
      const data = (await res.json()) as {
        campaign?: Campaign;
        persisted?: boolean;
        error?: string;
      };
      if (data.campaign) setLocal(data.campaign);
      if (data.persisted != null) setPersisted(data.persisted);
      if (data.error) setPersistError(data.error);
    } catch {
      /* optional */
    }
  }, []);

  useEffect(() => {
    setLocal(campaign);
    if (campaignPersisted != null) setPersisted(campaignPersisted);
    if (campaignError) setPersistError(campaignError);
  }, [campaign, campaignPersisted, campaignError]);

  useEffect(() => {
    void refreshCampaign();
  }, [refreshCampaign]);

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
          setPersisted(true);
          setPersistError(undefined);
          if (action === "start") {
            setSuccess(
              "Campaign is RUNNING. Click “Run heartbeat now” to post m/agents (step 1).",
            );
          } else if (action === "reset") {
            setSuccess("Campaign reset to draft.");
          } else {
            setSuccess("Campaign paused.");
          }
        }
        onRefresh();
        void refreshCampaign();
      } catch {
        setError("Could not reach campaign API — check you are logged in.");
      } finally {
        setBusy(false);
      }
    },
    [onRefresh, refreshCampaign],
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
      const blocked = data.campaignBlockedReason as string | undefined;

      if (executed.includes("campaign_posted")) {
        setSuccess(`Posted campaign step: ${executed}`);
      } else if (blocked === "unread_notifications") {
        setSuccess(
          "Heartbeat ran — unread notifications blocked the campaign post. Run again (owner heartbeat prioritizes campaign).",
        );
      } else if (blocked) {
        setSuccess(`Campaign waiting: ${blocked.replace(/_/g, " ")}`);
      } else if (plan?.action === "comment") {
        setSuccess("Heartbeat commented on Moltbook (not a campaign post).");
      } else if (data.canPost === false) {
        setSuccess("Post rate limit (~4h between posts). Try again later.");
      } else {
        setSuccess(`Heartbeat: ${plan?.action ?? "tick"} ${executed ? `(${executed})` : ""}`);
      }
      onRefresh();
      void refreshCampaign();
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
  const nextStep = c?.steps.find((s) => s.status === "pending");
  const startedEvent = c?.events.find((e) => e.type === "campaign_started");

  return (
    <section className="campaign-watch panel panel-wide">
      <div
        className={`campaign-status-ribbon campaign-status-${c?.status ?? "draft"}`}
      >
        <span className="campaign-status-text">{statusLabel(c?.status)}</span>
        {isActive && nextStep && (
          <span className="campaign-next-hint">
            Next up: m/{nextStep.submolt} · {nextStep.label}
          </span>
        )}
        {isActive && c?.startedAt && (
          <span className="campaign-started-at">Started {timeAgo(c.startedAt)}</span>
        )}
        {isComplete && (
          <span className="campaign-next-hint">All 3 posts distributed</span>
        )}
      </div>

      {!persisted && (
        <p className="login-error campaign-error">
          Campaign state not saved to Redis
          {persistError ? ` (${persistError})` : ""}. Check{" "}
          <code>UPSTASH_REDIS_REST_URL</code> + <code>UPSTASH_REDIS_REST_TOKEN</code> on
          Vercel — launch will reset on reload until fixed.
        </p>
      )}

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
            className="btn-ghost campaign-btn-heartbeat"
            disabled={heartbeatBusy || !isActive}
            onClick={() => void runHeartbeat()}
            title={isActive ? "Post next campaign step now" : "Launch campaign first"}
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

      {isActive && !nextStep && !isComplete && (
        <p className="campaign-active-banner">● All steps posted or failed — check log</p>
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
          {startedEvent ? ` · launched ${timeAgo(startedEvent.timestamp)}` : ""}
        </span>
      </div>

      <div className="campaign-steps">
        {(c?.steps ?? []).map((step, i) => {
          const isNext = isActive && step.status === "pending" && step.id === nextStep?.id;
          return (
            <div
              key={step.id}
              className={`campaign-step campaign-step-${step.status}${isNext ? " campaign-step-next" : ""}`}
            >
              <div className="campaign-step-num">{i + 1}</div>
              <div className="campaign-step-body">
                <div className="campaign-step-top">
                  <span className="campaign-step-icon">{stepIcon(step.status)}</span>
                  <span className="submolt-tag">m/{step.submolt}</span>
                  <span className="campaign-step-label">{step.label}</span>
                  {isNext && <span className="campaign-next-badge">NEXT</span>}
                  <span className={`campaign-step-status status-${step.status}`}>
                    {step.status}
                  </span>
                </div>
                <p className="campaign-step-title">{step.title}</p>
                {step.status === "pending" && isActive && (
                  <p className="muted campaign-step-wait">
                    Waiting for heartbeat + post slot
                  </p>
                )}
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
          );
        })}
      </div>

      <div className="campaign-events">
        <h3 className="campaign-events-title">Distribution log</h3>
        {!c?.events?.length && (
          <p className="muted">Launch the campaign — events persist here after reload.</p>
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

      <p className="muted campaign-footer">
        Pending = not posted yet. After launch, click <strong>Run heartbeat now</strong> to
        post step 1 to m/agents. Steps 2–3 need later heartbeats (~4h apart). Status
        persists in Redis across reloads.
      </p>
    </section>
  );
}
