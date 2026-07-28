/**
 * Reads a Twitch channel's chat, anonymously, from the browser.
 *
 * Twitch's IRC gateway accepts anonymous read-only connections: log in with
 * any nickname matching `justinfan<digits>` and no password, and you get the
 * full message stream for any public channel. That means a streamer can point
 * Punaab at their chat without creating an app, granting OAuth scopes, or
 * handing us a token — which is the difference between a feature people
 * actually turn on and one they mean to set up someday.
 *
 * Read-only by design. Punaab replies through the overlay, not into chat.
 */

export type ChatMessage = {
  platform: "twitch" | "kick";
  channel: string;
  author: string;
  /** Display colour the platform assigned them, when we can see it. */
  color?: string;
  text: string;
  /** Milliseconds since epoch. */
  at: number;
};

export type ChatClientOptions = {
  channel: string;
  onMessage: (message: ChatMessage) => void;
  onStatus?: (status: "connecting" | "open" | "closed" | "error") => void;
};

const TWITCH_IRC = "wss://irc-ws.chat.twitch.tv:443";

/** Parses an IRC line's `@key=value;key=value` tag prefix. */
function parseTags(raw: string): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const pair of raw.split(";")) {
    const index = pair.indexOf("=");
    if (index === -1) continue;
    tags[pair.slice(0, index)] = pair.slice(index + 1);
  }
  return tags;
}

export function connectTwitchChat(options: ChatClientOptions) {
  const channel = options.channel.trim().toLowerCase().replace(/^#/, "");
  let socket: WebSocket | null = null;
  let closed = false;
  let retry = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const open = () => {
    if (closed) return;
    options.onStatus?.("connecting");
    socket = new WebSocket(TWITCH_IRC);

    socket.onopen = () => {
      retry = 0;
      // `tags` gives us display names and colours; `commands` gives us
      // RECONNECT notices so we can get ahead of a server cycling.
      socket?.send("CAP REQ :twitch.tv/tags twitch.tv/commands");
      socket?.send(`NICK justinfan${Math.floor(Math.random() * 90000) + 10000}`);
      socket?.send(`JOIN #${channel}`);
      options.onStatus?.("open");
    };

    socket.onmessage = (event) => {
      const lines = String(event.data).split("\r\n");
      for (const line of lines) {
        if (!line) continue;

        // The server pings periodically and drops connections that don't
        // answer. This is the single most common reason a naive IRC client
        // "randomly" disconnects after a few minutes.
        if (line.startsWith("PING")) {
          socket?.send("PONG :tmi.twitch.tv");
          continue;
        }

        if (line.includes("RECONNECT")) {
          socket?.close();
          continue;
        }

        const match = /^(?:@(\S+)\s)?:(\S+?)!\S+\sPRIVMSG\s#(\S+)\s:(.*)$/.exec(
          line
        );
        if (!match) continue;

        const [, rawTags, login, room, text] = match;
        const tags = rawTags ? parseTags(rawTags) : {};

        options.onMessage({
          platform: "twitch",
          channel: room,
          author: tags["display-name"] || login,
          color: tags.color || undefined,
          text: text.trim(),
          at: Date.now(),
        });
      }
    };

    socket.onerror = () => options.onStatus?.("error");

    socket.onclose = () => {
      options.onStatus?.("closed");
      if (closed) return;
      // Exponential backoff, capped. Streams run for hours; hammering a
      // reconnect every second through a Twitch outage helps nobody.
      retry += 1;
      const delay = Math.min(30_000, 1000 * Math.pow(2, retry));
      reconnectTimer = setTimeout(open, delay);
    };
  };

  open();

  return () => {
    closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    socket?.close();
  };
}
