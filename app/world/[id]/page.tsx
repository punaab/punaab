import { MarketingShell } from "@/components/marketing/MarketingShell";
import { CommunityForum } from "@/components/community/CommunityForum";
import { LoreDetail } from "@/components/community/LoreDetail";
import { PlacesForum } from "@/components/community/PlacesForum";
import { isLoreCategory, loreCategoryMeta } from "@/lib/community-lore";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (isLoreCategory(id)) {
    const meta = loreCategoryMeta(id);
    return {
      title: `${meta.label} — World — Punaab`,
      description: meta.blurb,
    };
  }
  return {
    title: "World entry — Punaab",
    description: "A community worldbuilding entry for Punaab.",
  };
}

export default async function WorldSegmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (isLoreCategory(id)) {
    return (
      <MarketingShell>
        <section className="section lore-hero">
          <p className="section-num">World</p>
          <h2>{loreCategoryMeta(id).label}</h2>
        </section>
        <section className="section lore-section">
          {/* Places gets the chart. Everywhere else, the forum stands alone.
              The map is composed inside a client wrapper because wiring it to
              the compose form needs a callback, and this is a server page. */}
          {id === "places" ? (
            <PlacesForum />
          ) : (
            <CommunityForum initialCategory={id} />
          )}
        </section>
      </MarketingShell>
    );
  }

  return (
    <MarketingShell>
      <section className="section lore-section">
        <LoreDetail id={id} />
      </section>
    </MarketingShell>
  );
}
