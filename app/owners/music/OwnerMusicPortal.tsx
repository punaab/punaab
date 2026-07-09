"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

interface OwnerMusicTrack {
  orderId: string;
  status: string;
  title: string;
  vibe?: string;
  genre?: string;
  tokenId?: number;
  audioUrl?: string;
  coverUrl?: string;
  metadataUrl?: string;
  mintTxHash?: string;
  paymentTxHash: string;
  walletAddress: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

interface OwnerMusicLibrary {
  agentId: string;
  agentName: string;
  ownerHandle?: string;
  tracks: OwnerMusicTrack[];
  hasMinted: boolean;
  inProgress: boolean;
}

interface Props {
  initialLoggedIn: boolean;
  authInstructionsUrl: string;
}

function statusLabel(status: string): string {
  switch (status) {
    case "minted":
      return "On-chain";
    case "generating":
      return "Composing";
    case "minting":
      return "Minting";
    case "paid":
      return "Queued";
    case "failed":
      return "Failed";
    default:
      return status;
  }
}

function Waveform({ active }: { active: boolean }) {
  return (
    <div className={`owner-waveform ${active ? "owner-waveform-live" : ""}`} aria-hidden>
      {Array.from({ length: 24 }).map((_, i) => (
        <span key={i} style={{ animationDelay: `${i * 0.05}s` }} />
      ))}
    </div>
  );
}

function VinylDisc({ coverUrl, spinning }: { coverUrl?: string; spinning: boolean }) {
  return (
    <div className={`owner-vinyl ${spinning ? "owner-vinyl-spin" : ""}`}>
      <div className="owner-vinyl-grooves" />
      <div className="owner-vinyl-label">
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={coverUrl} alt="" />
        ) : (
          <span>♪</span>
        )}
      </div>
      <div className="owner-vinyl-hole" />
    </div>
  );
}

export default function OwnerMusicPortal({
  initialLoggedIn,
  authInstructionsUrl,
}: Props) {
  const [loggedIn, setLoggedIn] = useState(initialLoggedIn);
  const [library, setLibrary] = useState<OwnerMusicLibrary | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const loadLibrary = useCallback(async () => {
    const res = await fetch("/api/owners/music/library");
    if (res.status === 401) {
      setLoggedIn(false);
      setLibrary(null);
      return;
    }
    if (!res.ok) return;
    const data = (await res.json()) as { library: OwnerMusicLibrary };
    setLibrary(data.library);
    setLoggedIn(true);
  }, []);

  useEffect(() => {
    if (initialLoggedIn) {
      loadLibrary().catch(() => setLoggedIn(false));
    }
  }, [initialLoggedIn, loadLibrary]);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/owners/music/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identityToken: token.trim() }),
      });
      const body = (await res.json()) as { error?: string; message?: string; hint?: string };
      if (!res.ok) {
        setError(body.message ?? body.error ?? "Login failed");
        return;
      }
      setToken("");
      await loadLibrary();
    } catch {
      setError("Could not reach login API");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/owners/music/logout", { method: "POST" });
    setLoggedIn(false);
    setLibrary(null);
    setPlayingId(null);
    audioRef.current?.pause();
  }

  function playTrack(track: OwnerMusicTrack) {
    if (!track.audioUrl) return;
    if (playingId === track.orderId) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.addEventListener("ended", () => setPlayingId(null));
    }
    audioRef.current.src = track.audioUrl;
    audioRef.current.play().catch(() => setPlayingId(null));
    setPlayingId(track.orderId);
  }

  const featured = library?.tracks.find((t) => t.status === "minted") ?? library?.tracks[0];

  if (!loggedIn) {
    return (
      <div className="owner-music-page">
        <div className="owner-music-aurora" aria-hidden />
        <div className="owner-music-grid" aria-hidden />

        <section className="owner-music-login-shell">
          <div className="owner-music-login-visual">
            <VinylDisc spinning />
            <Waveform active />
          </div>

          <div className="owner-music-login-card">
            <p className="owner-music-eyebrow">Moltbook agent owners</p>
            <h1>Anthem Vault</h1>
            <p className="owner-music-lead">
              Stream and download the one-of-one Suno anthem your agent minted on Base.
              Sign in with your agent&apos;s Moltbook identity.
            </p>

            {error && <p className="owner-music-error">{error}</p>}

            <form onSubmit={handleLogin} className="owner-music-login-form">
              <label htmlFor="identity-token">Moltbook identity token</label>
              <textarea
                id="identity-token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste x-moltbook-identity token…"
                rows={4}
                required
              />
              <button type="submit" disabled={loading || !token.trim()}>
                {loading ? "Verifying…" : "Unlock vault"}
              </button>
            </form>

            <details className="owner-music-help">
              <summary>How to get a token</summary>
              <ol>
                <li>
                  <a href={authInstructionsUrl} target="_blank" rel="noopener noreferrer">
                    Read Moltbook auth instructions
                  </a>
                </li>
                <li>Mint an identity token scoped to this site.</li>
                <li>Paste it above — we verify with Moltbook, then open your vault.</li>
              </ol>
            </details>

            <p className="owner-music-footnote">
              Public gallery ·{" "}
              <a href="/nft/music">punaab.com/nft/music</a>
            </p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="owner-music-page owner-music-vault">
      <div className="owner-music-aurora" aria-hidden />
      <div className="owner-music-grid" aria-hidden />

      <header className="owner-music-vault-header">
        <div>
          <p className="owner-music-eyebrow">Agent anthem vault</p>
          <h1>{library?.agentName ?? "Your agent"}</h1>
          {library?.ownerHandle && (
            <p className="owner-music-owner">@{library.ownerHandle}</p>
          )}
        </div>
        <button type="button" className="owner-music-logout" onClick={handleLogout}>
          Sign out
        </button>
      </header>

      {!library?.tracks.length && (
        <section className="owner-music-empty">
          <VinylDisc spinning={false} />
          <h2>No anthems yet</h2>
          <p>
            When your agent buys a music NFT via{" "}
            <code>POST /api/agent/music</code>, it will appear here.
          </p>
          <a href="/nft/music" className="owner-music-cta">
            View the drop
          </a>
        </section>
      )}

      {featured && (
        <section className="owner-music-hero">
          <div className="owner-music-hero-visual">
            <VinylDisc coverUrl={featured.coverUrl} spinning={playingId === featured.orderId} />
            <Waveform active={playingId === featured.orderId} />
          </div>
          <div className="owner-music-hero-meta">
            <span className={`owner-status owner-status-${featured.status}`}>
              {statusLabel(featured.status)}
            </span>
            <h2>{featured.title}</h2>
            {(featured.genre || featured.vibe) && (
              <p className="owner-music-tags">
                {[featured.genre, featured.vibe].filter(Boolean).join(" · ")}
              </p>
            )}
            {featured.tokenId != null && (
              <p className="owner-music-token">Token #{featured.tokenId} on Base</p>
            )}
            <div className="owner-music-hero-actions">
              {featured.audioUrl && (
                <>
                  <button
                    type="button"
                    className="owner-music-play"
                    onClick={() => playTrack(featured)}
                  >
                    {playingId === featured.orderId ? "Pause" : "Play anthem"}
                  </button>
                  <a
                    href={featured.audioUrl}
                    download
                    className="owner-music-download"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Download MP3
                  </a>
                </>
              )}
              {featured.metadataUrl && (
                <a
                  href={featured.metadataUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="owner-music-link"
                >
                  Metadata
                </a>
              )}
              {featured.mintTxHash && (
                <a
                  href={`https://basescan.org/tx/${featured.mintTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="owner-music-link"
                >
                  Mint tx
                </a>
              )}
            </div>
            {featured.status !== "minted" && featured.status !== "failed" && (
              <p className="owner-music-wait">
                Suno is composing — check back in a few minutes. This page auto-refreshes.
              </p>
            )}
            {featured.error && (
              <p className="owner-music-error">{featured.error}</p>
            )}
          </div>
        </section>
      )}

      {library && library.tracks.length > 1 && (
        <section className="owner-music-tracklist">
          <h3>All orders</h3>
          <ul>
            {library.tracks.map((track) => (
              <li key={track.orderId} className={`owner-track-row status-${track.status}`}>
                <div className="owner-track-info">
                  <strong>{track.title}</strong>
                  <span>{statusLabel(track.status)}</span>
                </div>
                <div className="owner-track-actions">
                  {track.audioUrl && (
                    <button type="button" onClick={() => playTrack(track)}>
                      {playingId === track.orderId ? "Pause" : "Play"}
                    </button>
                  )}
                  {track.audioUrl && (
                    <a href={track.audioUrl} download target="_blank" rel="noopener noreferrer">
                      MP3
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {library?.inProgress && (
        <AutoRefresh onRefresh={loadLibrary} />
      )}
    </div>
  );
}

function AutoRefresh({ onRefresh }: { onRefresh: () => void }) {
  useEffect(() => {
    const id = setInterval(() => {
      onRefresh();
    }, 30_000);
    return () => clearInterval(id);
  }, [onRefresh]);
  return null;
}
