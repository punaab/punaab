"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { getAppearance } from "@/lib/bard/palettes";
import { connectTwitchChat, type ChatMessage } from "@/lib/embed/twitch";
import { connectKickChat } from "@/lib/embed/kick";

const BardPreview = dynamic(
  () => import("@/components/downloads/BardPreview").then((m) => m.BardPreview),
  { ssr: false, loading: () => <div className="punaab-embed-stage-fallback" /> }
);

type Bridge = {
  platform: "twitch" | "kick";
  channel: string;
  respond_mode: "mentions" | "commands" | "all";
  trigger_prefix: string;
  cooldown_seconds: number;
};

type EmbedConfig = {
  name: string;
  appearance: string;
  surface: "web" | "obs";
  bridges: Bridge[];
};

type Turn = {
  id: number;
  role: "user" | "bard";
  text: string;
  author?: string;
  platform?: "twitch" | "kick";
};

/**
 * Punaab, embedded.
 *
 * Two surfaces share this component because they are the same character doing
 * the same thing, and splitting them would mean fixing every bug twice:
 *
 *   - `web`: a chat box on a customer's site. Visitors type; he answers.
 *   - `obs`: a transparent stream overlay. Nobody types — he answers Twitch
 *     and Kick chat, and only the bard and his speech bubble are drawn.
 */
export function PunaabEmbed({
  token,
  apiBase = "",
  surface,
}: {
  token: string;
  apiBase?: string;
  surface: "web" | "obs";
}) {
  const [config, setConfig] = useState<EmbedConfig | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [bubble, setBubble] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  const turnId = useRef(0);
  const lastReplyAt = useRef(0);
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // --- Config -------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${apiBase}/api/v1/embed/config?token=${encodeURIComponent(token)}`
        );
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error ?? "Could not load this embed.");
          return;
        }
        setConfig(json as EmbedConfig);
      } catch {
        if (!cancelled) setError("Could not reach Punaab.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, token]);

  const say = useCallback((text: string) => {
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    setBubble(text);
    setPlaying(true);
    const duration = Math.max(4000, Math.min(14_000, text.length * 70));
    bubbleTimer.current = setTimeout(() => {
      setBubble(null);
      setPlaying(false);
    }, duration);
  }, []);

  // --- Asking him something ----------------------------------------------
  const ask = useCallback(
    async (
      message: string,
      meta?: { author?: string; source?: "web" | "twitch" | "kick" | "obs" }
    ) => {
      if (!message.trim()) return;
      setBusy(true);
      setError(null);

      const id = ++turnId.current;
      setTurns((prev) =>
        [
          ...prev,
          {
            id,
            role: "user" as const,
            text: message,
            author: meta?.author,
            platform:
              meta?.source === "twitch" || meta?.source === "kick"
                ? meta.source
                : undefined,
          },
        ].slice(-40)
      );

      try {
        const res = await fetch(`${apiBase}/api/v1/embed/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-punaab-embed": token,
          },
          body: JSON.stringify({
            message,
            source: meta?.source ?? surface,
            author: meta?.author,
            // Only the recent exchange — enough for continuity, not enough to
            // make every message cost a novel's worth of context.
            history: turnsToHistory(turns),
          }),
        });
        const json = await res.json();

        if (!res.ok) {
          setError(json.error ?? "Punaab could not answer just now.");
          return;
        }

        setTurns((prev) =>
          [...prev, { id: ++turnId.current, role: "bard" as const, text: json.reply }].slice(-40)
        );
        say(json.reply);
      } catch {
        setError("Punaab could not answer just now.");
      } finally {
        setBusy(false);
      }
    },
    [apiBase, token, surface, turns, say]
  );

  // --- Live chat bridges --------------------------------------------------
  useEffect(() => {
    if (!config?.bridges?.length) return;

    const disconnects: Array<() => void> = [];

    const handle = (bridge: Bridge) => (message: ChatMessage) => {
      const text = message.text.trim();
      if (!text) return;

      // Rate limit first, before any string work. A busy stream produces
      // hundreds of messages a minute and each reply costs credits.
      const now = Date.now();
      if (now - lastReplyAt.current < bridge.cooldown_seconds * 1000) return;

      let prompt = text;
      if (bridge.respond_mode === "commands") {
        if (!text.toLowerCase().startsWith(bridge.trigger_prefix.toLowerCase())) {
          return;
        }
        prompt = text.slice(bridge.trigger_prefix.length).trim();
        if (!prompt) return;
      } else if (bridge.respond_mode === "mentions") {
        const name = (config.name || "punaab").toLowerCase();
        if (!text.toLowerCase().includes(name)) return;
      }

      lastReplyAt.current = now;
      void ask(prompt, { author: message.author, source: bridge.platform });
    };

    for (const bridge of config.bridges) {
      if (bridge.platform === "twitch") {
        disconnects.push(
          connectTwitchChat({ channel: bridge.channel, onMessage: handle(bridge) })
        );
      } else {
        disconnects.push(
          connectKickChat({ channel: bridge.channel, onMessage: handle(bridge) })
        );
      }
    }

    return () => {
      for (const disconnect of disconnects) disconnect();
    };
    // `ask` changes on every turn; re-subscribing to chat on each message would
    // drop and reopen the sockets constantly. The bridges only need rebuilding
    // when the config does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns]);

  useEffect(() => {
    return () => {
      if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    };
  }, []);

  const palette = getAppearance(config?.appearance).palette;

  if (error && !config) {
    return (
      <div className="punaab-embed punaab-embed-error">
        <p>{error}</p>
      </div>
    );
  }

  // --- OBS overlay --------------------------------------------------------
  // Transparent, chrome-free: just him and what he's saying.
  if (surface === "obs") {
    return (
      <div className="punaab-overlay">
        <div className="punaab-overlay-bubble-slot">
          {bubble && <div className="punaab-overlay-bubble">{bubble}</div>}
        </div>
        <div className="punaab-overlay-bard">
          <BardPreview palette={palette} playing={playing} />
        </div>
      </div>
    );
  }

  // --- Website widget -----------------------------------------------------
  return (
    <div className="punaab-embed">
      <div className="punaab-embed-stage">
        <BardPreview palette={palette} playing={playing} />
        {bubble && <div className="punaab-embed-bubble">{bubble}</div>}
      </div>

      <div className="punaab-embed-chat">
        <div className="punaab-embed-log" ref={scrollRef}>
          {turns.length === 0 && (
            <p className="punaab-embed-hint">
              {config?.name ?? "Punaab"} is here. Ask him anything —
              he&rsquo;s walked a long way and he likes to talk.
            </p>
          )}
          {turns.map((turn) => (
            <div
              key={turn.id}
              className={`punaab-turn punaab-turn-${turn.role}`}
            >
              {turn.author && (
                <span className={`punaab-turn-author is-${turn.platform ?? "web"}`}>
                  {turn.author}
                </span>
              )}
              <span className="punaab-turn-text">{turn.text}</span>
            </div>
          ))}
          {busy && <div className="punaab-turn punaab-turn-typing">…</div>}
        </div>

        {error && <p className="punaab-embed-error-line">{error}</p>}

        <form
          className="punaab-embed-form"
          onSubmit={(event) => {
            event.preventDefault();
            const value = input;
            setInput("");
            void ask(value, { source: "web" });
          }}
        >
          <input
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Say something to Punaab…"
            maxLength={600}
            disabled={busy}
            aria-label="Message Punaab"
          />
          <button type="submit" disabled={busy || !input.trim()}>
            Send
          </button>
        </form>

        <a
          className="punaab-embed-credit"
          href="https://punaab.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          Powered by Punaab
        </a>
      </div>
    </div>
  );
}

/** The last few exchanges, in the shape the chat endpoint expects. */
function turnsToHistory(turns: Turn[]) {
  return turns.slice(-6).map((turn) => ({
    role: turn.role === "bard" ? ("assistant" as const) : ("user" as const),
    content: turn.text.slice(0, 1200),
  }));
}
