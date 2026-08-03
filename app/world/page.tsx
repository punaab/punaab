import { MarketingShell } from "@/components/marketing/MarketingShell";
import { WorldComingSoon } from "@/components/marketing/WorldComingSoon";
import { TravelPageTitle } from "@/components/marketing/TravelPageTitle";
import { WorldStageFocus } from "@/components/marketing/WorldStageFocus";

export const metadata = {
  title: "World — Punaab the traveling bard",
  description:
    "The Land of Pixelgrew is coming soon — watch this space for the living valley.",
};

export default function WorldPage() {
  return (
    <MarketingShell showSiteLoader={false}>
      <section className="travel-page">
        <header className="travel-page-head">
          <p className="section-num">World</p>
          <TravelPageTitle>LAND OF PIXELGREW</TravelPageTitle>
          <p className="section-lead">
            The living valley is on its way. Stay a moment — the road will open.
          </p>
        </header>

        <WorldStageFocus>
          <div className="travel-stage">
            <WorldComingSoon />
          </div>
        </WorldStageFocus>
      </section>
    </MarketingShell>
  );
}
