"use client";

const SECTIONS = [
  { id: "admin-arb", label: "Arbitrage" },
  { id: "admin-agent", label: "Agent" },
  { id: "admin-web3", label: "Web3" },
  { id: "admin-campaign", label: "Campaign" },
  { id: "admin-nfts", label: "NFTs" },
  { id: "admin-logs", label: "Logs" },
] as const;

interface Props {
  online: boolean;
  karma?: number;
  unread?: number;
}

export default function AdminNav({ online, karma, unread }: Props) {
  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <nav className="admin-nav" aria-label="Admin sections">
      <div className="admin-nav-inner">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className="admin-nav-item"
            onClick={() => scrollTo(s.id)}
          >
            {s.label}
          </button>
        ))}
        <div className="admin-nav-meta">
          <span className={`admin-nav-dot ${online ? "online" : ""}`} />
          <span className="admin-nav-stat">{karma ?? "—"} karma</span>
          {(unread ?? 0) > 0 && (
            <span className="admin-nav-badge">{unread}</span>
          )}
        </div>
      </div>
    </nav>
  );
}
