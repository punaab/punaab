"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export default function OwnerChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [speak, setSpeak] = useState(true);
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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

    try {
      const res = await fetch("/api/admin/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages, speak }),
      });
      const data = (await res.json()) as {
        reply?: string;
        error?: string;
        voiceEnabled?: boolean;
        audio?: { base64: string; mimeType: string };
      };

      if (!res.ok) {
        setError(data.error ?? "Chat failed");
        return;
      }

      setVoiceAvailable(Boolean(data.voiceEnabled));
      if (data.reply) {
        setMessages((prev) => [...prev, { role: "assistant", content: data.reply! }]);
      }
      if (speak && data.audio?.base64) {
        playAudio(data.audio.base64, data.audio.mimeType);
      }
    } catch {
      setError("Could not reach Punaab");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel panel-chat">
      <div className="chat-header">
        <h2>Talk to Punaab</h2>
        {voiceAvailable && (
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
        Private chat with your agent — text replies; voice when ElevenLabs is configured.
      </p>

      <div className="chat-log" ref={scrollRef}>
        {messages.length === 0 && (
          <p className="muted chat-empty">
            Ask about status, plans, trading, or what Punaab has been up to.
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={`${i}-${m.role}`}
            className={`chat-bubble chat-bubble-${m.role}`}
          >
            <span className="chat-role">{m.role === "user" ? "You" : "Punaab"}</span>
            <p>{m.content}</p>
          </div>
        ))}
        {loading && (
          <div className="chat-bubble chat-bubble-assistant chat-loading">
            <span className="chat-role">Punaab</span>
            <p className="muted">Thinking…</p>
          </div>
        )}
      </div>

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
          placeholder="Message Punaab…"
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
