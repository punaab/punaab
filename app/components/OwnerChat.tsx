"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  moltbookLink?: string;
}

interface ChatMeta {
  handle: string;
  profileUrl: string;
  avatarUrl?: string | null;
  karma?: number;
  description?: string;
  moltbookConnected: boolean;
  ownerChatPostId?: string;
  voiceEnabled: boolean;
}

export default function OwnerChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [meta, setMeta] = useState<ChatMeta | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [speak, setSpeak] = useState(true);
  const [saveAsPlan, setSaveAsPlan] = useState(false);
  const [postToMoltbook, setPostToMoltbook] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const loadMeta = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/chat");
      if (res.ok) {
        setMeta((await res.json()) as ChatMeta);
      }
    } catch {
      /* optional */
    }
  }, []);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, loading]);

  const playAudio = useCallback((base64: string, mimeType: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
      URL.revokeObjectURL(audioRef.current.src);
    }
    const blob = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([blob], { type: mimeType }));
    const audio = new Audio(url);
    audioRef.current = audio;
    void audio.play().catch(() => {
      /* autoplay blocked */
    });
  }, []);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: text },
    ];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    setError("");
    setStatus("");

    try {
      const res = await fetch("/api/admin/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages,
          speak,
          saveAsPlan,
          postToMoltbook,
        }),
      });
      const data = (await res.json()) as {
        reply?: string;
        error?: string;
        voiceEnabled?: boolean;
        audio?: { base64: string; mimeType: string };
        postedCommentUrl?: string;
        planSaved?: boolean;
        moltbookUrl?: string;
        karma?: number;
      };

      if (data.karma != null && meta) {
        setMeta({ ...meta, karma: data.karma });
      }

      if (!res.ok && !data.reply) {
        setError(data.error ?? "Chat failed");
        return;
      }

      if (data.error && data.reply) {
        setError(data.error);
      }

      if (data.reply) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.reply!,
            moltbookLink: data.postedCommentUrl,
          },
        ]);
      }

      const statusParts: string[] = [];
      if (data.planSaved) statusParts.push("Saved to agent plans");
      if (data.postedCommentUrl) statusParts.push("Posted on Moltbook");
      if (statusParts.length) setStatus(statusParts.join(" · "));

      if (speak && data.audio?.base64) {
        playAudio(data.audio.base64, data.audio.mimeType);
      }
    } catch {
      setError("Could not reach Punaab");
    } finally {
      setLoading(false);
    }
  }

  const handle = meta?.handle ?? "punaab";
  const profileUrl = meta?.profileUrl ?? `https://www.moltbook.com/u/${handle}`;

  return (
    <section className="panel panel-chat">
      <div className="chat-header">
        <div className="chat-identity">
          {meta?.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={meta.avatarUrl} alt={handle} className="chat-avatar" />
          ) : (
            <div className="chat-avatar chat-avatar-placeholder">P</div>
          )}
          <div>
            <h2>
              <a href={profileUrl} target="_blank" rel="noopener noreferrer">
                u/{handle}
              </a>
            </h2>
            <p className="muted chat-meta-line">
              {meta?.moltbookConnected ? (
                <>
                  <span className="chat-live-dot" /> Live Moltbook agent ·{" "}
                  {meta.karma ?? "—"} karma
                </>
              ) : (
                "Connecting to Moltbook…"
              )}
            </p>
          </div>
        </div>
        {meta?.voiceEnabled && (
          <label className="chat-speak-toggle">
            <input
              type="checkbox"
              checked={speak}
              onChange={(e) => setSpeak(e.target.checked)}
            />
            Voice
          </label>
        )}
      </div>
      <p className="muted section-hint">
        Same brain as{" "}
        <a href={profileUrl} target="_blank" rel="noopener noreferrer">
          moltbook.com/u/{handle}
        </a>
        — live profile, posts, heartbeat memory. ElevenLabs speaks replies only.
      </p>

      <div className="chat-options">
        <label className="chat-option">
          <input
            type="checkbox"
            checked={saveAsPlan}
            onChange={(e) => setSaveAsPlan(e.target.checked)}
          />
          Remember for heartbeats
        </label>
        <label
          className="chat-option"
          title={
            meta?.ownerChatPostId
              ? "Also comment on your owner thread on Moltbook"
              : "Set MOLTBOOK_OWNER_CHAT_POST_ID on server"
          }
        >
          <input
            type="checkbox"
            checked={postToMoltbook}
            onChange={(e) => setPostToMoltbook(e.target.checked)}
            disabled={!meta?.ownerChatPostId}
          />
          Reply on Moltbook
        </label>
      </div>

      <div className="chat-log" ref={scrollRef}>
        {messages.length === 0 && (
          <p className="muted chat-empty">
            You&apos;re talking to the real Punaab — ask what he posted, his karma
            strategy, campaign status, or give instructions for the next heartbeat.
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={`${i}-${m.role}`}
            className={`chat-bubble chat-bubble-${m.role}`}
          >
            <span className="chat-role">{m.role === "user" ? "You" : "Punaab"}</span>
            <p>{m.content}</p>
            {m.moltbookLink && (
              <a
                href={m.moltbookLink}
                target="_blank"
                rel="noopener noreferrer"
                className="chat-moltbook-link"
              >
                View on Moltbook →
              </a>
            )}
          </div>
        ))}
        {loading && (
          <div className="chat-bubble chat-bubble-assistant chat-loading">
            <span className="chat-role">Punaab</span>
            <p className="muted">Thinking…</p>
          </div>
        )}
      </div>

      {status && <p className="campaign-success chat-status">{status}</p>}
      {error && <p className="login-error chat-error">{error}</p>}

      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          type="text"
          className="chat-input"
          placeholder={`Message u/${handle}…`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
        />
        <button type="submit" className="btn-ghost chat-send" disabled={loading}>
          Send
        </button>
      </form>
    </section>
  );
}
