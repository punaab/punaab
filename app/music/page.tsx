import Image from "next/image";
import { MarketingShell } from "@/components/marketing/MarketingShell";
import { MusicLibrary } from "@/components/music/MusicLibrary";
import { PUNAAB_LUTE_PREVIEW_URL } from "@/lib/bard/punaab-model";

export const metadata = {
  title: "Music — Punaab",
  description:
    "Free downloadable fantasy music for your games — Punaab's tracks are CC BY. Use, arrange & perform with credit.",
};

export default function MusicPage() {
  return (
    <MarketingShell>
      <section className="section music-page">
        <div className="music-page-top">
          <p className="section-num">Music</p>
          <aside className="music-license" aria-label="Open license">
            <span className="music-license-mark">CC BY</span>
            <p>
              Open license — use with credit:
              <code>SongTitle - Punaab</code>
            </p>
          </aside>
        </div>

        <div className="music-lute-banner" aria-hidden="true">
            <Image
              src={PUNAAB_LUTE_PREVIEW_URL}
              alt=""
              width={640}
              height={640}
              className="music-lute-art"
              priority
              unoptimized
            />
        </div>

        <div className="music-headline">
          <div className="music-headline-copy">
            <h2>Free tracks for the road</h2>
            <p className="section-lead">
              Royalty-free music for your world. Take 1 track or the whole
              package.
            </p>
          </div>
          <a
            className="btn primary btn-glow music-download-all"
            href="/downloads/punaab-music.zip"
            download="punaab-music.zip"
          >
            Download all
          </a>
        </div>

        <MusicLibrary />
      </section>
    </MarketingShell>
  );
}
