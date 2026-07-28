import { MarketingShell } from "@/components/marketing/MarketingShell";
import { BardWorldLazy } from "@/components/marketing/BardWorldLazy";
import { CommunityLinks } from "@/components/marketing/CommunityLinks";
import { SiteLink } from "@/components/marketing/SiteLink";
import { COMMUNITY_PITCH } from "@/lib/community";
import { FEATURES, FEATURES_NOTE } from "@/lib/nav";

export default function HomePage() {
  return (
    <MarketingShell>
      <section className="hero product-hero hero-live">
        <div className="hero-watermark" aria-hidden="true">
          PUNAAB
        </div>
        <div className="hero-copy hero-copy-animate">
          <p className="hero-kicker">Free traveling bard</p>
          <h1>
            Meet Punaab —
            <span className="hero-gradient-line"> the traveling bard</span>
          </h1>
          <p className="hero-desc">
            Free to download. Drop him into your game or story — he chats,
            sings, trades, and wanders the road with players.
          </p>
          <p className="hero-inspiration" aria-hidden="true">
            <span className="hero-inspiration-rule" />
            <span className="hero-inspiration-text">For your inspiration</span>
            <span className="hero-inspiration-rule" />
          </p>
          <div className="hero-actions">
            <SiteLink className="btn primary btn-glow btn-xl" href="/demo">
              Free download
            </SiteLink>
            <SiteLink className="btn ghost" href="/#project">
              Join the community
            </SiteLink>
          </div>
        </div>
        <div className="hero-stage hero-stage-3d">
          <BardWorldLazy />
        </div>
      </section>

      <section id="project" className="section project-band">
        <p className="section-num">Project</p>
        <h2>Free. Yours to use.</h2>
        <p className="section-lead">{COMMUNITY_PITCH}</p>
        <CommunityLinks />
        <ul className="feature-grid">
          {FEATURES.map((f) => (
            <li key={f} className="feature-chip">
              <span className="check">✓</span> {f}
            </li>
          ))}
        </ul>
        <p className="feature-note">{FEATURES_NOTE}</p>
      </section>

      <section className="section cta-band cta-glow">
        <h2>Drop Punaab Into Your Game</h2>
        <p>
          Start a project, take your key, fetch the plugin, paste it in, and
          hear him play.
        </p>
        <SiteLink className="btn primary btn-glow btn-xl" href="/docs/getting-started">
          Start in 5 minutes
        </SiteLink>
      </section>
    </MarketingShell>
  );
}
