import { COMMUNITY } from "@/lib/community";

const LINKS = [
  { href: COMMUNITY.x, label: "X Twitter", className: "is-x" },
  { href: COMMUNITY.pump, label: "PUMP.FUN", className: "is-pump" },
  { href: COMMUNITY.github, label: "GitHub", className: "is-github" },
] as const;

export function CommunityLinks({
  className = "",
}: {
  className?: string;
}) {
  return (
    <div className={`community-links${className ? ` ${className}` : ""}`}>
      {LINKS.map((link) => (
        <a
          key={link.href}
          className={`community-link ${link.className}`}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
        >
          {link.label}
        </a>
      ))}
    </div>
  );
}
