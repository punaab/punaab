import { MarketingShell } from "@/components/marketing/MarketingShell";
import { CommunityForum } from "@/components/community/CommunityForum";
import { redirect } from "next/navigation";
import { isLoreCategory } from "@/lib/community-lore";

export const metadata = {
  title: "Archive — Punaab",
  description:
    "Help us world-build: browse trending and latest submissions, then open characters, art, quests, and more.",
};

export default async function ArchivePage({
  searchParams,
}: {
  searchParams: Promise<{ area?: string }>;
}) {
  const params = await searchParams;
  // Legacy ?area= links → /archive/[category]
  if (params.area && isLoreCategory(params.area)) {
    redirect(`/archive/${params.area}`);
  }
  if (params.area === "world" || params.area === "songs") {
    redirect("/archive/history");
  }

  return (
    <MarketingShell>
      <section className="section lore-hero">
        <p className="section-num">Archive</p>
        <h2>SHARE YOUR STORY</h2>
      </section>

      <section className="section lore-section">
        <CommunityForum initialCategory={null} />
      </section>
    </MarketingShell>
  );
}
