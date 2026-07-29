import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { LoreReviewQueue } from "@/components/community/LoreReviewQueue";
import { isLoreAdmin } from "@/lib/lore-admin";

export const metadata = {
  title: "Review worldbuild — Punaab",
  description: "Accept or deny pending community worldbuilding submissions.",
};

export default async function WorldReviewPage() {
  const { userId } = await auth();
  if (!isLoreAdmin(userId)) notFound();

  return (
    <MarketingShell>
      <section className="section lore-section">
        <p className="section-num">Review</p>
        <h2>Pending submissions</h2>
        <p className="section-lead">
          Accept to publish into the hall, graph, and downloads. Deny to keep it
          out of the public packs.
        </p>
        <LoreReviewQueue />
      </section>
    </MarketingShell>
  );
}
