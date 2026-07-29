import Link from "next/link";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { GuildNav } from "@/components/dashboard/GuildNav";

export function DashboardShell({
  children,
  title,
  subtitle,
  primaryAction = {
    href: "/dashboard/ledger",
    label: "OPEN LEDGER",
  },
}: {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
  primaryAction?: { href: string; label: string } | null;
}) {
  return (
    <MarketingShell>
      <div className="guild-hall">
        <div className="guild-hall-atmosphere" aria-hidden="true">
          <span className="guild-hall-glow guild-hall-glow-a" />
          <span className="guild-hall-glow guild-hall-glow-b" />
          <span className="guild-hall-motif">✦</span>
        </div>

        <GuildNav />

        <header className="guild-hall-hero">
          <div className="guild-hall-hero-frame">
            <span className="guild-hall-corner guild-hall-corner-tl" aria-hidden="true" />
            <span className="guild-hall-corner guild-hall-corner-tr" aria-hidden="true" />
            <span className="guild-hall-corner guild-hall-corner-bl" aria-hidden="true" />
            <span className="guild-hall-corner guild-hall-corner-br" aria-hidden="true" />

            <p className="guild-hall-eyebrow">
              <span aria-hidden="true">❧</span> Guild hall <span aria-hidden="true">❧</span>
            </p>
            <div className="guild-hall-hero-row">
              <div className="guild-hall-copy">
                <h1>{title}</h1>
                {subtitle ? <p>{subtitle}</p> : null}
              </div>
              {primaryAction ? (
                <Link href={primaryAction.href} className="btn primary btn-glow guild-hall-cta">
                  {primaryAction.label}
                </Link>
              ) : null}
            </div>
          </div>
        </header>

        <div className="guild-hall-content">{children}</div>
      </div>
    </MarketingShell>
  );
}
