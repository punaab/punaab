import Image from "next/image";
import { AuthNav } from "@/components/AuthControls";
import { LoadingScreen } from "@/components/LoadingScreen";
import { PumpTicker } from "@/components/marketing/PumpTicker";
import { SiteLink } from "@/components/marketing/SiteLink";
import { COMMUNITY } from "@/lib/community";

const NAV = [
  { href: "/#project", label: "Project" },
  { href: "/music", label: "Music" },
  { href: "/plugins", label: "Plugins" },
  { href: "/pricing", label: "Plans" },
  { href: "/docs", label: "How-To" },
  { href: "/demo", label: "Demo" },
] as const;

export function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="site-root">
      <LoadingScreen />
      <div className="mkt-top">
        <header className="mkt-header">
          <SiteLink href="/" className="brand">
            <Image
              src="/assets/solana.png"
              alt="Punaab"
              width={56}
              height={56}
              className="brand-mark"
            />
            <span className="brand-lockup">
              <span className="brand-text">Punaab</span>
              <span className="brand-tagline" aria-hidden="true">
                <span>The Traveling</span>
                <span>Bard</span>
              </span>
            </span>
          </SiteLink>
          <nav className="mkt-nav" aria-label="Primary">
            {NAV.map((item) => (
              <SiteLink key={item.href} href={item.href} className="nav-pill">
                {item.label}
              </SiteLink>
            ))}
          </nav>
          <div className="mkt-actions">
            <AuthNav />
            <SiteLink href="/dashboard" className="btn primary btn-glow header-cta">
              Let’s Build!
            </SiteLink>
          </div>
        </header>
        <PumpTicker />
      </div>
      <main>{children}</main>
      <footer className="site-footer">
        <span>© 2026 Punaab</span>
        <span className="dot">•</span>
        <SiteLink href="/demo">Free download</SiteLink>
        <span className="dot">•</span>
        <SiteLink href="/docs">How-To</SiteLink>
        <span className="dot">•</span>
        <SiteLink href="/music">Music</SiteLink>
        <span className="dot">•</span>
        <SiteLink href="/plugins">Plugins</SiteLink>
        <span className="dot">•</span>
        <SiteLink href="/pricing">Plans</SiteLink>
        <div className="site-footer-socials">
          <a href={COMMUNITY.x} target="_blank" rel="noopener noreferrer">
            X Twitter
          </a>
          <span className="dot">•</span>
          <a href={COMMUNITY.pump} target="_blank" rel="noopener noreferrer">
            PUMP.FUN
          </a>
          <span className="dot">•</span>
          <a href={COMMUNITY.github} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
