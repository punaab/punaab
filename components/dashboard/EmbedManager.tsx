"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  EmbedPlatformMark,
  type EmbedPlatform,
} from "@/components/embed/EmbedPlatformMark";
import type { PlanCapabilities } from "@/lib/plans";

export type EmbedTokenRow = {
  id: string;
  project_id: string;
  name: string;
  token: string;
  allowed_origins: string[];
  surface: "web" | "obs";
  daily_credit_cap: number;
  enabled: boolean;
  last_used_at: string | null;
};

export type BridgeRow = {
  id: string;
  project_id: string;
  platform: "twitch" | "kick";
  channel: string;
  respond_mode: "mentions" | "commands" | "all";
  trigger_prefix: string;
  cooldown_seconds: number;
};

type Project = { id: string; name: string };

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="embed-copy">
      <span className="embed-copy-label">{label}</span>
      <code className="embed-copy-value">{value}</code>
      <button
        type="button"
        className="btn ghost embed-copy-button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          } catch {
            // Clipboard access can be blocked; the value is selectable anyway.
          }
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/**
 * Where subscribers set up embeds, stream overlays and chat bridges.
 *
 * The origin allowlist is the part that most needs explaining in the UI rather
 * than in docs: an embed token is public by nature, so the allowlist is the
 * only thing standing between it and anyone who views source on the page it
 * lives in. New tokens therefore start locked to nothing.
 */
export function EmbedManager({
  projects,
  tokens,
  bridges,
  capabilities,
  appOrigin,
}: {
  projects: Project[];
  tokens: EmbedTokenRow[];
  bridges: BridgeRow[];
  capabilities: PlanCapabilities;
  appOrigin: string;
}) {
  const router = useRouter();
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [name, setName] = useState("My website");
  const [surface, setSurface] = useState<"web" | "obs">("web");
  const [origins, setOrigins] = useState("");
  const [cap, setCap] = useState(2000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [bridgePlatform, setBridgePlatform] = useState<"twitch" | "kick">("twitch");
  const [bridgeChannel, setBridgeChannel] = useState("");
  const [bridgeMode, setBridgeMode] =
    useState<"mentions" | "commands" | "all">("mentions");

  const locked = !capabilities.websiteEmbed && !capabilities.obsOverlay;

  const createToken = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/embed/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          name,
          surface,
          allowed_origins: origins
            .split(/[\n,]/)
            .map((value) => value.trim())
            .filter(Boolean),
          daily_credit_cap: cap,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not create token");
      setOrigins("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create token");
    } finally {
      setBusy(false);
    }
  }, [projectId, name, surface, origins, cap, router]);

  const revokeToken = useCallback(
    async (id: string) => {
      await fetch("/api/v1/embed/tokens", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, revoke: true }),
      });
      router.refresh();
    },
    [router]
  );

  const addBridge = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/embed/bridges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          platform: bridgePlatform,
          channel: bridgeChannel,
          respond_mode: bridgeMode,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not add channel");
      setBridgeChannel("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add channel");
    } finally {
      setBusy(false);
    }
  }, [projectId, bridgePlatform, bridgeChannel, bridgeMode, router]);

  const removeBridge = useCallback(
    async (id: string) => {
      await fetch(`/api/v1/embed/bridges?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      router.refresh();
    },
    [router]
  );

  const webTokens = useMemo(
    () => tokens.filter((t) => t.surface === "web"),
    [tokens]
  );
  const obsTokens = useMemo(
    () => tokens.filter((t) => t.surface === "obs"),
    [tokens]
  );

  if (locked) {
    return (
      <>
        <article className="card">
          <p className="meta">Creator plan</p>
          <h2>Unlock embeds &amp; streaming</h2>
          <p>
            See every option below. Subscribe to create website embeds, OBS
            overlays, and Twitch / Kick chat bridges.
          </p>
          <div className="hero-actions">
            <Link className="btn primary btn-glow" href="/pricing">
              See plans
            </Link>
            <Link className="btn ghost" href="/embeds">
              Preview on /embeds
            </Link>
          </div>
        </article>

        <div className="embed-showcase">
          {(
            [
              {
                id: "web" as EmbedPlatform,
                meta: "website",
                title: "Website embed",
                blurb: "One script tag. Visitors chat with Punaab on your site.",
                preview: `<script src="${appOrigin}/embed.js" data-punaab="YOUR_TOKEN" async></script>`,
              },
              {
                id: "obs" as EmbedPlatform,
                meta: "streaming",
                title: "OBS browser source",
                blurb:
                  "Transparent overlay for OBS / Streamlabs. He walks and talks over your stream.",
                preview: `${appOrigin}/obs/YOUR_TOKEN\nSources → Browser · 480×640 · transparent`,
              },
              {
                id: "twitch" as EmbedPlatform,
                meta: "live chat",
                title: "Twitch chat",
                blurb: "He answers viewers who mention him or use !punaab.",
                preview: "Platform: Twitch · Mode: mentions / commands / all",
              },
              {
                id: "kick" as EmbedPlatform,
                meta: "live chat",
                title: "Kick chat",
                blurb: "Same live bridge for Kick channels.",
                preview: "Platform: Kick · Mode: mentions / commands / all",
              },
            ] as const
          ).map((option) => (
            <article key={option.id} className="card embed-option">
              <div className="embed-option-head">
                <div className="embed-option-brand">
                  <EmbedPlatformMark platform={option.id} />
                  <p className="meta">{option.meta}</p>
                </div>
                <span className="embed-lock-badge">Locked</span>
              </div>
              <h2>{option.title}</h2>
              <p>{option.blurb}</p>
              <pre className="embed-option-preview">{option.preview}</pre>
              <div className="hero-actions" style={{ marginTop: "1rem" }}>
                <Link className="btn primary" href="/pricing">
                  See plans
                </Link>
              </div>
            </article>
          ))}
        </div>
      </>
    );
  }

  if (!projects.length) {
    return (
      <article className="card">
        <h2>Create a project first</h2>
        <p>Embeds attach to a project, so Punaab knows which character to be.</p>
        <Link className="btn primary" href="/dashboard/projects">
          New project
        </Link>
      </article>
    );
  }

  return (
    <>
      <article className="card">
        <h2>New embed</h2>
        <div className="embed-form">
          <div className="form-row">
            <label htmlFor="embed-project">Project</label>
            <select
              id="embed-project"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <label htmlFor="embed-name">Name</label>
            <input
              id="embed-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="form-row">
            <label htmlFor="embed-surface">Where</label>
            <select
              id="embed-surface"
              value={surface}
              onChange={(event) =>
                setSurface(event.target.value as "web" | "obs")
              }
            >
              <option value="web">My website (script tag)</option>
              <option value="obs">OBS overlay (browser source)</option>
            </select>
          </div>

          {surface === "web" && (
            <div className="form-row">
              <label htmlFor="embed-origins">Allowed domains</label>
              <textarea
                id="embed-origins"
                rows={3}
                value={origins}
                onChange={(event) => setOrigins(event.target.value)}
                placeholder={"https://example.com\nhttps://*.example.com"}
              />
              <p className="bard-field-note">
                One per line. This token is visible to anyone who views source
                on your page, so it only works on the domains you list here.
                <code>https://*.example.com</code> covers subdomains and preview
                deploys.
              </p>
            </div>
          )}

          <div className="form-row">
            <label htmlFor="embed-cap">Daily credit cap</label>
            <input
              id="embed-cap"
              type="number"
              min={1}
              max={1000000}
              value={cap}
              onChange={(event) => setCap(Number(event.target.value))}
            />
            <p className="bard-field-note">
              Hard ceiling on what this embed can spend per day, so a busy day
              — or a scraped token — can never drain your balance.
            </p>
          </div>

          <button
            type="button"
            className="btn primary"
            onClick={createToken}
            disabled={busy || !projectId}
          >
            {busy ? "Creating…" : "Create embed"}
          </button>
          {error && <p className="embed-error">{error}</p>}
        </div>
      </article>

      {webTokens.length > 0 && (
        <article className="card">
          <p className="meta">website</p>
          <h2>Site embeds</h2>
          {webTokens.map((token) => (
            <div key={token.id} className="embed-row">
              <div className="embed-row-head">
                <h3>{token.name}</h3>
                <button
                  type="button"
                  className="btn ghost embed-revoke"
                  onClick={() => revokeToken(token.id)}
                >
                  Revoke
                </button>
              </div>

              <CopyField
                label="Script tag"
                value={`<script src="${appOrigin}/embed.js" data-punaab="${token.token}" async></script>`}
              />

              <p className="bard-field-note">
                Allowed on:{" "}
                {token.allowed_origins.length
                  ? token.allowed_origins.join(", ")
                  : "nowhere yet — add a domain to switch it on"}
                {" · "}
                {token.daily_credit_cap.toLocaleString()} credits/day
              </p>
            </div>
          ))}
        </article>
      )}

      {obsTokens.length > 0 && (
        <article className="card">
          <p className="meta">streaming</p>
          <h2>OBS overlays</h2>
          {obsTokens.map((token) => (
            <div key={token.id} className="embed-row">
              <div className="embed-row-head">
                <h3>{token.name}</h3>
                <button
                  type="button"
                  className="btn ghost embed-revoke"
                  onClick={() => revokeToken(token.id)}
                >
                  Revoke
                </button>
              </div>

              <CopyField
                label="Browser source URL"
                value={`${appOrigin}/obs/${token.token}`}
              />

              <p className="bard-field-note">
                In OBS: <strong>Sources → + → Browser</strong>, paste that URL,
                set the size to 480×640, and tick{" "}
                <em>Shutdown source when not visible</em>. The background is
                already transparent — no chroma key needed.
              </p>
            </div>
          ))}
        </article>
      )}

      <article className="card">
        <p className="meta">live chat</p>
        <h2>Twitch &amp; Kick</h2>
        <p>
          Point Punaab at a channel and he&rsquo;ll answer chat on stream. He
          reads only — he never posts as you.
        </p>

        <div className="embed-form embed-form-inline">
          <div className="form-row">
            <label htmlFor="bridge-platform">Platform</label>
            <select
              id="bridge-platform"
              value={bridgePlatform}
              onChange={(event) =>
                setBridgePlatform(event.target.value as "twitch" | "kick")
              }
            >
              <option value="twitch">Twitch</option>
              <option value="kick">Kick</option>
            </select>
          </div>
          <div className="form-row">
            <label htmlFor="bridge-channel">Channel</label>
            <input
              id="bridge-channel"
              value={bridgeChannel}
              onChange={(event) => setBridgeChannel(event.target.value)}
              placeholder="your_channel_name"
            />
          </div>
          <div className="form-row">
            <label htmlFor="bridge-mode">Replies to</label>
            <select
              id="bridge-mode"
              value={bridgeMode}
              onChange={(event) =>
                setBridgeMode(
                  event.target.value as "mentions" | "commands" | "all"
                )
              }
            >
              <option value="mentions">Messages that mention him</option>
              <option value="commands">!punaab commands only</option>
              <option value="all">Everything (uses credits fast)</option>
            </select>
          </div>
          <button
            type="button"
            className="btn primary"
            onClick={addBridge}
            disabled={busy || !bridgeChannel.trim()}
          >
            Add channel
          </button>
        </div>

        {bridges.length > 0 && (
          <ul className="embed-bridge-list">
            {bridges.map((bridge) => (
              <li key={bridge.id}>
                <span className={`embed-platform is-${bridge.platform}`}>
                  {bridge.platform}
                </span>
                <strong>{bridge.channel}</strong>
                <span className="embed-bridge-mode">{bridge.respond_mode}</span>
                <button
                  type="button"
                  className="btn ghost embed-revoke"
                  onClick={() => removeBridge(bridge.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </article>
    </>
  );
}
