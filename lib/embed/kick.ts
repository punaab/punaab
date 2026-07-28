/**
 * Reads a Kick channel's chat from the browser.
 *
 * Kick has no IRC gateway. Its site subscribes to a public Pusher cluster, so
 * we do the same: resolve the channel slug to its numeric chatroom id via
 * Kick's public API, then join `chatrooms.<id>.v2` on Pusher as an anonymous
 * subscriber. No credentials, read-only.
 *
 * This rides on Kick's own front-end infrastructure rather than a documented
 * public API, so it is more fragile than the Twitch bridge — the app key or
 * the channel shape can change without notice. It fails soft: a status of
 * "error" turns the bridge off in the UI and the rest of the overlay carries
 * on working.
 */

import type { ChatMessage } from "./twitch";

// Kick's public front-end Pusher app. Not a secret — it is served in their
// own JavaScript to every visitor.
const KICK_PUSHER_KEY = "32cbd69e4b950bf97679";
const KICK_PUSHER_CLUSTER = "us2";

type KickChannel = { chatroomId: number; slug: string };

async function resolveChatroom(slug: string): Promise<KickChannel | null> {
  try {
    const res = await fetch(
      `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`,
      { headers: { Accept: "application/json" } }
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { chatroom?: { id?: number } };
    const id = json.chatroom?.id;
    return id ? { chatroomId: id, slug } : null;
  } catch {
    return null;
  }
}

export function connectKickChat(options: {
  channel: string;
  onMessage: (message: ChatMessage) => void;
  onStatus?: (status: "connecting" | "open" | "closed" | "error") => void;
}) {
  const slug = options.channel.trim().toLowerCase();
  let socket: WebSocket | null = null;
  let closed = false;
  let retry = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const open = async () => {
    if (closed) return;
    options.onStatus?.("connecting");

    const channel = await resolveChatroom(slug);
    if (!channel) {
      options.onStatus?.("error");
      // Retry slowly: a bad slug will never resolve, and a fast loop against
      // Kick's API from every viewer's browser is abusive.
      if (!closed) reconnectTimer = setTimeout(open, 60_000);
      return;
    }

    const url =
      `wss://ws-${KICK_PUSHER_CLUSTER}.pusher.com/app/${KICK_PUSHER_KEY}` +
      `?protocol=7&client=js&version=8.4.0&flash=false`;
    socket = new WebSocket(url);

    socket.onopen = () => {
      retry = 0;
      socket?.send(
        JSON.stringify({
          event: "pusher:subscribe",
          data: { auth: "", channel: `chatrooms.${channel.chatroomId}.v2` },
        })
      );
      options.onStatus?.("open");
    };

    socket.onmessage = (event) => {
      try {
        const envelope = JSON.parse(String(event.data)) as {
          event?: string;
          data?: string;
        };
        if (envelope.event !== "App\\Events\\ChatMessageEvent") return;
        // Pusher double-encodes: the payload is a JSON string inside JSON.
        const payload = JSON.parse(envelope.data ?? "{}") as {
          content?: string;
          sender?: {
            username?: string;
            identity?: { color?: string };
          };
        };
        if (!payload.content) return;

        options.onMessage({
          platform: "kick",
          channel: slug,
          author: payload.sender?.username || "someone",
          color: payload.sender?.identity?.color,
          text: payload.content.trim(),
          at: Date.now(),
        });
      } catch {
        // Malformed frame — ignore it rather than tearing down the socket.
      }
    };

    socket.onerror = () => options.onStatus?.("error");

    socket.onclose = () => {
      options.onStatus?.("closed");
      if (closed) return;
      retry += 1;
      reconnectTimer = setTimeout(
        open,
        Math.min(30_000, 1000 * Math.pow(2, retry))
      );
    };
  };

  void open();

  return () => {
    closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    socket?.close();
  };
}
