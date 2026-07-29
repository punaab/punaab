import type { LoreCategoryId } from "@/lib/community-lore";

type LoreCategoryIconProps = {
  category: LoreCategoryId;
  className?: string;
  title?: string;
};

/**
 * Default glyph when a submission has no image — one clear mark per Archive area.
 */
export function LoreCategoryIcon({
  category,
  className,
  title,
}: LoreCategoryIconProps) {
  const common = {
    className,
    viewBox: "0 0 48 48",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": title ? undefined : (true as const),
    role: title ? ("img" as const) : undefined,
  };

  switch (category) {
    case "characters":
      return (
        <svg {...common}>
          {title ? <title>{title}</title> : null}
          <circle cx="24" cy="15" r="7" />
          <path d="M10 40c2.5-9 8-13.5 14-13.5S35.5 31 38 40" />
        </svg>
      );
    case "art":
      return (
        <svg {...common}>
          {title ? <title>{title}</title> : null}
          <rect x="8" y="11" width="32" height="26" rx="2.5" />
          <path d="M12 31l8-9 6 6 5-7 5 10" />
          <circle cx="31" cy="18" r="2.4" fill="currentColor" stroke="none" />
        </svg>
      );
    case "quests":
      return (
        <svg {...common}>
          {title ? <title>{title}</title> : null}
          <path d="M14 42V8" />
          <path d="M14 8h20l-5 7 5 7H14" fill="currentColor" fillOpacity="0.35" />
        </svg>
      );
    case "dialogue":
      return (
        <svg {...common}>
          {title ? <title>{title}</title> : null}
          <path d="M10 12h28a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H22l-8 8v-8h-4a3 3 0 0 1-3-3V15a3 3 0 0 1 3-3z" />
          <path d="M16 20h16M16 26h10" />
        </svg>
      );
    case "places":
      return (
        <svg {...common}>
          {title ? <title>{title}</title> : null}
          <path d="M8 22L24 8l16 14" />
          <path d="M12 20.5V40h24V20.5" />
          <path d="M20 40V28h8v12" />
        </svg>
      );
    case "items":
      return (
        <svg {...common}>
          {title ? <title>{title}</title> : null}
          <path d="M24 7l13 17-13 17L11 24z" fill="currentColor" fillOpacity="0.28" />
          <path d="M15 22h18M24 7v34" />
        </svg>
      );
    case "rumors":
      return (
        <svg {...common}>
          {title ? <title>{title}</title> : null}
          <circle cx="18" cy="22" r="7" />
          <circle cx="31" cy="26" r="5.5" />
          <circle cx="27" cy="14" r="3.5" />
          <circle
            cx="31"
            cy="26"
            r="1.8"
            fill="currentColor"
            stroke="none"
          />
        </svg>
      );
    case "history":
      return (
        <svg {...common}>
          {title ? <title>{title}</title> : null}
          <path d="M12 10h24v28H12z" fill="currentColor" fillOpacity="0.18" />
          <path d="M12 10h24v28H12z" />
          <path d="M17 18h14M17 24h14M17 30h9" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          {title ? <title>{title}</title> : null}
          <circle cx="24" cy="24" r="12" />
        </svg>
      );
  }
}
