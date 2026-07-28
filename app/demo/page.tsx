import Link from "next/link";
import Image from "next/image";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { CommunityLinks } from "@/components/marketing/CommunityLinks";
import { BardDownload } from "@/components/downloads/BardDownload";
import { COMMUNITY_PITCH } from "@/lib/community";

export const metadata = {
  title: "Free download — Punaab the traveling bard",
  description:
    "Download Punaab free. Use him in your game or story, change him, monetize — a community project.",
};

export default function DemoPage() {
  return (
    <MarketingShell>
      <section className="section">
        <p className="section-num">Free download</p>
        <h2>Take him with you.</h2>
        <p className="section-lead">
          {COMMUNITY_PITCH} No account needed for the model.
        </p>
        <div className="card" style={{ marginTop: "1.5rem" }}>
          <BardDownload />
        </div>
      </section>

      <section className="section community-band">
        <h2>Join the community</h2>
        <p className="section-lead">
          Follow along, share what you build, and help make Punaab better.
        </p>
        <CommunityLinks />
      </section>

      <section className="section">
        <h2>Then plug him into your game.</h2>
        <p className="section-lead">
          The model is free. Optional API adds conversation, songs, trading, and
          quests — in character — inside your project.
        </p>
        <div className="card" style={{ marginTop: "1.5rem", textAlign: "center" }}>
          <Image
            src="/assets/punaab-hoodie.png"
            alt="Punaab demo"
            width={280}
            height={280}
            className="hero-mascot"
          />
          <p id="watch-video">Watch Video placeholder — embed your launch trailer here.</p>
          <div className="hero-actions" style={{ justifyContent: "center" }}>
            <Link className="btn primary" href="/dashboard">
              Let’s Build!
            </Link>
            <Link className="btn ghost" href="/docs/getting-started">
              5-minute guide
            </Link>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
