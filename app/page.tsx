import { MarketingShell } from "@/components/marketing/MarketingShell";
import { CommunityLinks } from "@/components/marketing/CommunityLinks";
import { GoldLeaderboard } from "@/components/marketing/GoldLeaderboard";
import { NotebookMerch } from "@/components/marketing/NotebookMerch";
import { PoweredByPixelgrew } from "@/components/marketing/PoweredByPixelgrew";
import { SiteLink } from "@/components/marketing/SiteLink";
import { FEATURES } from "@/lib/nav";

const HOME_PROJECT_PITCH =
  "The Traveling Bard is free to download. Use him in your own story or game, change him, and monetize what you make. Share lore in the hall — this is a community project.";

export default function HomePage() {
  return (
    <MarketingShell>
      <section className="hero product-hero hero-live">
        <div className="hero-watermark" aria-hidden="true">
          PUNAAB
        </div>
        <div className="hero-copy hero-copy-animate">
          <PoweredByPixelgrew className="pixelgrew-credit-hero" />
          <h1>
            Find Punaab —
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
            <SiteLink className="btn primary btn-glow btn-xl" href="/world">
              World
            </SiteLink>
            <SiteLink className="btn ghost" href="/archive">
              Start Creating
            </SiteLink>
          </div>
        </div>
        <div className="hero-stage hero-stage-merch">
          <NotebookMerch className="notebook-merch-hero" />
        </div>
      </section>

      <section id="project" className="section project-band">
        <h2>Build Together. Yours to Use.</h2>
        <p className="section-lead">{HOME_PROJECT_PITCH}</p>
        <CommunityLinks />
        <SiteLink className="btn soft project-band-more" href="/project">
          Read the full project scroll
        </SiteLink>
      </section>

      <GoldLeaderboard />

      <section className="section home-features" aria-label="What Punaab can do">
        <ul className="feature-grid">
          {FEATURES.map((f) => (
            <li key={f} className="feature-chip">
              <span className="check">✓</span> {f}
            </li>
          ))}
        </ul>
      </section>
      <section className="section cta-band cta-glow">
        <h2>Write the next scrap of lore</h2>
        <p>
          Characters, quests, dialogue, places — sign in, publish an entry, and
          let the community upvote and refine it.
        </p>
        <SiteLink className="btn primary btn-glow btn-xl" href="/archive">
          Help us world-build
        </SiteLink>
      </section>
    </MarketingShell>
  );
}
