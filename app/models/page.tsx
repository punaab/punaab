import { MarketingShell } from "@/components/marketing/MarketingShell";
import { CommunityLinks } from "@/components/marketing/CommunityLinks";
import { SiteLink } from "@/components/marketing/SiteLink";
import { BardDownload } from "@/components/downloads/BardDownload";
import { COMMUNITY_PITCH } from "@/lib/community";

export const metadata = {
  title: "Models — Punaab the traveling bard",
    description:
    "Download free static Punaab 3D models (2K, 4K, 8K), backpack, lute, and reference art.",
};

export default function ModelsPage() {
  return (
    <MarketingShell>
      <section className="section">
        <p className="section-num">Models</p>
        <h2>Take him with you.</h2>
        <p className="section-lead">
          {COMMUNITY_PITCH} No account needed for the model.
        </p>
        <div className="card" style={{ marginTop: "1.5rem" }}>
          <BardDownload />
        </div>
      </section>

      <section className="section community-band">
        <h2>Share what you make</h2>
        <p className="section-lead">
          Built something with Punaab? Add characters, quests, or dialogue and
          help us worldbuild — or follow along on the road.
        </p>
        <CommunityLinks />
        <div className="hero-actions" style={{ justifyContent: "center", marginTop: "1.25rem" }}>
          <SiteLink className="btn primary btn-glow" href="/world">
            Help us world-build
          </SiteLink>
        </div>
      </section>
    </MarketingShell>
  );
}
