import Link from "next/link";
import Image from "next/image";
import { AuthNav } from "@/components/AuthControls";
import { LoadingScreen } from "@/components/LoadingScreen";
import { PumpTicker } from "@/components/marketing/PumpTicker";
import { COMMUNITY } from "@/lib/community";

const NAV = [
  { href: "/#project", label: "Project" },
  { href: "/music", label: "Music" },
  { href: "/embeds", label: "Embeds" },
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
          <Link href="/" className="brand">
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
          </Link>
          <nav className="mkt-nav" aria-label="Primary">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="nav-pill">
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="mkt-actions">
            <AuthNav />
            <Link href="/dashboard" className="btn primary btn-glow header-cta">
              Let’s Build!
            </Link>
          </div>
        </header>
        <PumpTicker />
      </div>
      <main>{children}</main>
      <footer className="site-footer">
        <span>© 2026 Punaab</span>
        <span className="dot">•</span>
        <Link href="/demo">Free download</Link>
        <span className="dot">•</span>
        <Link href="/docs">How-To</Link>
        <span className="dot">•</span>
        <Link href="/music">Music</Link>
        <span className="dot">•</span>
        <Link href="/embeds">Embeds</Link>
        <span className="dot">•</span>
        <Link href="/pricing">Plans</Link>
        <span className="dot">•</span>
        <Link href="/meet">Meet</Link>
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
