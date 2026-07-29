import { MarketingShell } from "@/components/marketing/MarketingShell";
import { BardWorldLazy } from "@/components/marketing/BardWorldLazy";
import { SiteLink } from "@/components/marketing/SiteLink";

export const metadata = {
  title: "Travel — Punaab the traveling bard",
  description:
    "Watch Punaab walk the valley — drag to look, play a song, open the map.",
};

export default function TravelPage() {
  return (
    <MarketingShell showSiteLoader={false}>
      <section className="travel-page">
        <header className="travel-page-head">
          <p className="section-num">Travel</p>
          <h1>PIXELGREW CONCEPT ART</h1>
          <p className="section-lead">
            Drag to look around. Play a song. Open the map and set him on the
            road.
          </p>
        </header>

        <div className="travel-stage-frame">
          <div className="travel-stage">
            <BardWorldLazy />
          </div>
        </div>

        <div className="travel-page-actions">
          <SiteLink className="btn soft" href="/world">
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
