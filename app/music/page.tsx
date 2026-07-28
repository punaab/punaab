import { MarketingShell } from "@/components/marketing/MarketingShell";
import { MusicLibrary } from "@/components/music/MusicLibrary";
import { MUSIC_TRACKS } from "@/lib/music";

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
          game or stream. {MUSIC_TRACKS.length} track
          {MUSIC_TRACKS.length === 1 ? "" : "s"} available.
        </p>
        <p className="bard-field-note" style={{ marginTop: "0.75rem" }}>
          Files live in <code>public/music/</code>. Add a track to the folder and
          register it in <code>lib/music.ts</code> to list it here.
        </p>
        <MusicLibrary />
      </section>
    </MarketingShell>
  );
}
