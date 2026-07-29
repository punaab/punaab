import Image from "next/image";
import { AuthNav } from "@/components/AuthControls";
import { LoadingScreen } from "@/components/LoadingScreen";
import { PumpTicker } from "@/components/marketing/PumpTicker";
import { ReferralCapture } from "@/components/marketing/ReferralCapture";
import { PoweredByPixelgrew } from "@/components/marketing/PoweredByPixelgrew";
import { SiteLink } from "@/components/marketing/SiteLink";
import { COMMUNITY } from "@/lib/community";

const NAV = [
  { href: "/project", label: "Project" },
  { href: "/travel", label: "Travel" },
  { href: "/world", label: "Archive" },
  { href: "/music", label: "Music" },
  { href: "/models", label: "Models" },
] as const;

export function MarketingShell({
  children,
  showSiteLoader = true,
}: {
  children: React.ReactNode;
  /** Full-page backpack boot. Off on /travel — the stage has its own bar. */
  showSiteLoader?: boolean;
}) {
  return (
    <div className="site-root">
      {showSiteLoader ? <LoadingScreen /> : null}
      <ReferralCapture />
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
            <SiteLink href="/travel" className="btn primary btn-glow header-cta">
              TRAVEL
            </SiteLink>
          </div>
        </header>
        <PumpTicker />
      </div>
      <main>{children}</main>
      <footer className="site-footer">
        <div className="site-footer-socials">
          <span>© 2026 punaab.com</span>
          <span className="dot">•</span>
          <a href={COMMUNITY.x} target="_blank" rel="noopener noreferrer">
            X Twitter
          </a>
          <span className="dot">•</span>
          <a href={COMMUNITY.telegram} target="_blank" rel="noopener noreferrer">
            Telegram
          </a>
          <span className="dot">•</span>
          <a href={COMMUNITY.pump} target="_blank" rel="noopener noreferrer">
            PUMP.FUN
          </a>
        </div>
        <PoweredByPixelgrew className="pixelgrew-credit-footer" />
      </footer>
    </div>
  );
}
