import { MarketingShell } from "@/components/marketing/MarketingShell";
import { CommunityForum } from "@/components/community/CommunityForum";
import { redirect } from "next/navigation";
import { isLoreCategory } from "@/lib/community-lore";

export const metadata = {
  title: "World — Punaab",
  description:
    "Help us world-build: browse trending and latest submissions, then open characters, art, quests, and more.",
};

export default async function WorldPage({
  searchParams,
}: {
  searchParams: Promise<{ area?: string }>;
}) {
  const params = await searchParams;
  // Legacy ?area= links → /world/[category]
  if (params.area && isLoreCategory(params.area)) {
    redirect(`/world/${params.area}`);
  }
  if (params.area === "world" || params.area === "songs") {
    redirect("/world/history");
  }

  return (
    <MarketingShell>
      <section className="section lore-hero">
        <p className="section-num">World</p>
        <h2>SHARE YOUR STORY</h2>
      </section>

      <section className="section lore-section">
        <CommunityForum initialCategory={null} />
      </section>
    </MarketingShell>
  );
}
