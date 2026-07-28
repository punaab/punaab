import { MarketingShell } from "@/components/marketing/MarketingShell";
import { MusicLibrary } from "@/components/music/MusicLibrary";

export const metadata = {
  title: "Music — Punaab",
  description:
    "Free downloadable fantasy music for your games — Punaab's walking ballad and more as it ships.",
};

export default function MusicPage() {
  return (
    <MarketingShell>
      <section className="section">
        <p className="section-num">Music</p>
        <h2>Free tracks for the road</h2>
        <p className="section-lead">
          Royalty-free music for Punaab&apos;s world. Download the .mp3 for your
          game or stream.
        </p>
        <MusicLibrary />
      </section>
    </MarketingShell>
  );
}
