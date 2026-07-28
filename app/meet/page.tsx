import Image from "next/image";
import Link from "next/link";
import { MarketingShell } from "@/components/marketing/MarketingShell";

export default function MeetPage() {
  return (
    <MarketingShell>
      <section className="meet">
        <div className="meet-art">
          <Image
            src="/assets/punaab-hoodie.png"
            alt="Meet Punaab"
            width={440}
            height={440}
            priority
            className="meet-portrait"
          />
        </div>
        <div className="meet-copy">
          <p className="hero-kicker">Meet the bard</p>
          <h1>Punaab</h1>
          <p className="hero-desc">
            The traveling bard behind the API — songs, shops, and stories for
            your game worlds.
          </p>
          <div className="hero-actions">
            <Link className="btn primary" href="/dashboard">
              Let’s Build!
            </Link>
            <Link className="btn soft" href="/demo">
              See Demo
            </Link>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
