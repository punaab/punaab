import { auth } from "@clerk/nextjs/server";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { EmbedShowcase } from "@/components/embed/EmbedShowcase";
import { capabilitiesFor } from "@/lib/plans";
import { ensureProfile } from "@/lib/profiles";

export const metadata = {
  title: "Embeds & Streaming — Punaab",
  description:
    "Embed Punaab on your website, drop him into OBS, and bridge Twitch or Kick chat. See every option — unlock with an account.",
};

export default async function PublicEmbedsPage() {
  const { userId } = await auth();
  let unlocked = false;

  if (userId) {
    try {
      const { profile } = await ensureProfile(userId);
      const caps = capabilitiesFor(profile.plan_code);
      unlocked = caps.websiteEmbed || caps.obsOverlay;
    } catch {
      unlocked = false;
    }
  }

  return (
    <MarketingShell>
      <section className="section">
        <p className="section-num">Embeds &amp; Streaming</p>
        <h2>Put Punaab on your site and stream.</h2>
        <p className="section-lead">
          Website script, OBS browser source, Twitch and Kick chat — all listed
          here. Locked options unlock when you sign up and subscribe.
        </p>
        <EmbedShowcase unlocked={unlocked} />
      </section>
    </MarketingShell>
  );
}
