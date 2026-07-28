export type EmbedPlatform = "web" | "obs" | "twitch" | "kick";

const LABELS: Record<EmbedPlatform, string> = {
  web: "Website",
  obs: "OBS",
  twitch: "Twitch",
  kick: "Kick",
};

function WebGlyph() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden focusable="false">
      <rect
        x="3"
        y="6"
        width="26"
        height="20"
        rx="3"
        fill="currentColor"
        opacity="0.22"
      />
      <rect
        x="3"
        y="6"
        width="26"
        height="20"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
      />
      <path
        d="M3 12h26"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
      />
      <circle cx="8" cy="9" r="1.2" fill="currentColor" />
      <circle cx="12" cy="9" r="1.2" fill="currentColor" />
      <path
        d="M11 17.5h4.5M16.5 17.5H21M13.5 21h5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Simplified OBS Studio mark — concentric rings / lens. */
function ObsGlyph() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden focusable="false">
      <circle cx="16" cy="16" r="11.5" fill="none" stroke="#5ce1e6" strokeWidth="2.6" />
      <circle cx="16" cy="16" r="7.2" fill="none" stroke="#8b5cf6" strokeWidth="2.4" />
      <circle cx="16" cy="16" r="3.1" fill="#22c55e" />
      <path
        d="M16 4.5v3.2M27.5 16h-3.2M16 27.5v-3.2M4.5 16h3.2"
        stroke="#fbbf24"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Twitch glitch mark (simplified). */
function TwitchGlyph() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden focusable="false">
      <path
        fill="currentColor"
        d="M7 4h18v12.5l-5 5H14l-3.5 3.5V21.5H7V4zm3 3v12h4.2v3.2L17.4 19H22V7H10zm6.2 3.2h2.4v5.2h-2.4V10.2zm-5 0h2.4v5.2H11.2V10.2z"
      />
    </svg>
  );
}

/** Kick mark — bold K silhouette. */
function KickGlyph() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden focusable="false">
      <path
        fill="currentColor"
        d="M8 5h5.2v9.1L19.6 5H26l-7.4 9.4L26 27h-6.5l-6.3-8.9V27H8V5z"
      />
    </svg>
  );
}

function Glyph({ platform }: { platform: EmbedPlatform }) {
  switch (platform) {
    case "web":
      return <WebGlyph />;
    case "obs":
      return <ObsGlyph />;
    case "twitch":
      return <TwitchGlyph />;
    case "kick":
      return <KickGlyph />;
  }
}

export function EmbedPlatformMark({
  platform,
  className = "",
}: {
  platform: EmbedPlatform;
  className?: string;
}) {
  return (
    <span
      className={`embed-platform-mark is-${platform}${className ? ` ${className}` : ""}`}
      title={LABELS[platform]}
      aria-label={LABELS[platform]}
      role="img"
    >
      <Glyph platform={platform} />
    </span>
  );
}
