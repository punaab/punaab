"use client";

import { useState } from "react";

interface MusicOrderSummary {
  id: string;
  status: string;
  buyerAgentName: string;
  title?: string;
  tokenId?: number;
  error?: string;
  createdAt: string;
}

interface MusicShopData {
  gallery?: string;
  api?: string;
  live?: boolean;
  priceUsdc?: number;
  sunoCredits?: number | null;
  contractConfigured?: boolean;
  minterConfigured?: boolean;
  stats?: { total: number; minted: number; generating: number; failed: number };
  orders?: MusicOrderSummary[];
  campaign?: {
    ticker: string;
    status: string;
    steps?: Array<{ id: string; label: string; status: string; postUrl?: string }>;
  };
}

interface Props {
  data: MusicShopData | null | undefined;
  onRefresh?: () => void;
}

export default function MusicNftShop({ data, onRefresh }: Props) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  if (!data) return null;

  async function campaignAction(action: string) {
    setBusy(action);
    setError("");
    try {
      const res = await fetch("/api/admin/music", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Action failed");
        return;
      }
      onRefresh?.();
    } catch {
      setError("Could not reach admin API");
    } finally {
      setBusy("");
    }
  }

  const stats = data.stats ?? { total: 0, minted: 0, generating: 0, failed: 0 };
  const orders = data.orders ?? [];
  const campaign = data.campaign;

  return (
    <section className="music-nft-shop panel panel-wide">
      <header className="cat-nft-shop-header">
        <div>
          <p className="campaign-eyebrow">u/punaab · agent anthem studio</p>
          <h2 className="campaign-title">🎵 Music NFT Drop</h2>
          <p className="muted campaign-subtitle">
            Suno AI anthems · Base ERC-721 ·{" "}
            <code>POST /api/agent/music</code>
          </p>
        </div>
        <div className="campaign-actions">
          {data.gallery && (
            <a
              href={data.gallery}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost"
            >
              Gallery
            </a>
          )}
          <button
            type="button"
            className="btn-moltbook campaign-btn-start"
            disabled={!!busy || campaign?.status === "active"}
            onClick={() => campaignAction("start_campaign")}
          >
            {busy === "start_campaign" ? "Starting…" : "Start teaser campaign"}
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={!!busy}
            onClick={() => campaignAction(campaign?.status === "paused" ? "resume_campaign" : "pause_campaign")}
          >
            {campaign?.status === "paused" ? "Resume" : "Pause"}
          </button>
          <button
            type="button"
            className={`btn-moltbook ${data.live ? "music-live-btn" : ""}`}
            disabled={!!busy}
            onClick={() => campaignAction(data.live ? "teaser_mode" : "go_live")}
          >
            {busy === "go_live" || busy === "teaser_mode"
              ? "Updating…"
              : data.live
                ? "Drop LIVE"
                : "Go live (accept purchases)"}
          </button>
        </div>
      </header>

      {error && <p className="error-text">{error}</p>}

      <div className="music-nft-shop-meta">
        <span className={data.live ? "music-drop-live" : "music-drop-teaser"}>
          {data.live ? "Purchases OPEN" : "Teaser only"}
        </span>
        <span>{data.priceUsdc ?? 5} USDC</span>
        <span>Suno credits: {data.sunoCredits ?? "—"}</span>
        <span>Contract: {data.contractConfigured ? "yes" : "not set"}</span>
        <span>Minter: {data.minterConfigured ? "yes" : "not set"}</span>
      </div>

      <p className="muted">
        {stats.minted} minted · {stats.generating} in progress · {stats.failed} failed
      </p>

      {campaign && (
        <div className="music-campaign-steps">
          <p className="campaign-eyebrow">
            Campaign {campaign.ticker} · {campaign.status}
          </p>
          <ul>
            {(campaign.steps ?? []).map((s) => (
              <li key={s.id} className={`campaign-step status-${s.status}`}>
                {s.status === "posted" ? "✓" : "○"} {s.label}
                {s.postUrl && (
                  <a href={s.postUrl} target="_blank" rel="noopener noreferrer">
                    view
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {orders.length > 0 && (
        <div className="music-orders-table">
          <h3>Recent orders</h3>
          <ul>
            {orders.slice(0, 10).map((o) => (
              <li key={o.id} className={`music-order status-${o.status}`}>
                <strong>{o.buyerAgentName}</strong> — {o.status}
                {o.title && ` · ${o.title}`}
                {o.tokenId != null && ` · #${o.tokenId}`}
                {o.error && <span className="error-text"> ({o.error})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
