import { MarketingShell } from "@/components/marketing/MarketingShell";
import { BardWorldLazy } from "@/components/marketing/BardWorldLazy";
import { SiteLink } from "@/components/marketing/SiteLink";
import { WorldStageFocus } from "@/components/marketing/WorldStageFocus";

export const metadata = {
  title: "World — Punaab the traveling bard",
  description:
    "Watch Punaab walk the valley — drag to look, play a song, open the map.",
};

export default function WorldPage() {
  return (
    <MarketingShell showSiteLoader={false}>
      <section className="travel-page">
        <header className="travel-page-head">
          <p className="section-num">World</p>
          <h1 className="travel-page-title">PIXELGREW CONCEPT WORLD</h1>
          <p className="section-lead">
            Drag to look around. Play a song. Open the map and set him on the
            road.
          </p>
        </header>

        <WorldStageFocus>
          <div className="travel-stage">
            <BardWorldLazy />
          </div>
        </WorldStageFocus>

        <div className="travel-page-actions">
          <SiteLink className="btn soft" href="/archive">
            Contribute to the Archive
          </SiteLink>
          <SiteLink className="btn ghost" href="/models">
            Free models
          </SiteLink>
        </div>
      </section>
    </MarketingShell>
  );
}
