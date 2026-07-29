import { MarketingShell } from "@/components/marketing/MarketingShell";
import { CommunityLinks } from "@/components/marketing/CommunityLinks";
import { SiteLink } from "@/components/marketing/SiteLink";
import { COMMUNITY_PITCH } from "@/lib/community";
import { FEATURES } from "@/lib/nav";

export const metadata = {
  title: "Project — Punaab",
  description:
    "The Punaab scroll: what the traveling bard is, what you can download and build, and how to help the valley grow.",
};

const CHAPTERS = [
  { id: "preamble", label: "I. Preamble" },
  { id: "offerings", label: "II. What this place offers" },
  { id: "create", label: "III. Create your character" },
  { id: "world", label: "IV. World Archive" },
  { id: "music", label: "V. Music" },
  { id: "models", label: "VI. Models" },
  { id: "coin", label: "VII. Coin & Camp" },
  { id: "help", label: "VIII. How to Help" },
] as const;

export default function ProjectPage() {
  return (
    <MarketingShell>
      <article className="section project-doc">
        <header className="project-doc-masthead">
          <p className="section-num">Project</p>
          <p className="project-doc-seal" aria-hidden="true">
            ✦ The Open Scroll ✦
          </p>
          <h1>Build Together. Yours to Use.</h1>
          <p className="project-doc-lede">{COMMUNITY_PITCH}</p>
          <CommunityLinks />
          <div className="project-doc-cta-row">
            <SiteLink className="btn primary btn-glow" href="/archive">
              Help us world-build
            </SiteLink>
            <SiteLink className="btn soft" href="/models">
              Grab free models
            </SiteLink>
            <SiteLink className="btn soft" href="/music">
              Download music
            </SiteLink>
          </div>
        </header>

        <nav className="project-doc-toc" aria-label="Scroll contents">
          <p className="project-doc-toc-title">Contents of this scroll</p>
          <ol>
            {CHAPTERS.map((chapter) => (
              <li key={chapter.id}>
                <a href={`#${chapter.id}`}>{chapter.label}</a>
              </li>
            ))}
          </ol>
        </nav>

        <section id="preamble" className="project-doc-chapter">
          <h2>
            <span className="project-doc-roman">I.</span> Preamble
          </h2>
          <p>
            Punaab is a traveling bard you can drop into your own game or story.
            He chats, sings, trades, and wanders — free to download, free to
            remix, and yours to monetize when you ship something with him.
          </p>
          <p>
            This site is the camp around him: a living valley to watch, a hall
            for shared lore, open music, and free 3D meshes. No gatekeepers on
            the assets. The community builds the world; you take what you need
            for the road.
          </p>
          <div className="project-doc-callout">
            <strong>Disclaimer:</strong> I&apos;m not a 3d artist, I&apos;m a
            musician. We would love any help we could get for this community
            project.
          </div>
          <SiteLink className="btn primary" href="/">
            Meet him on the homepage
          </SiteLink>
        </section>

        <section id="offerings" className="project-doc-chapter">
          <h2>
            <span className="project-doc-roman">II.</span> What this place
            offers
          </h2>
          <p>
            Same promises as the homepage — spelled out so you know what you
            are walking into.
          </p>
          <ul className="feature-grid project-doc-features">
            {FEATURES.map((f) => (
              <li key={f} className="feature-chip">
                <span className="check">✓</span> {f}
              </li>
            ))}
          </ul>
        </section>

        <section id="create" className="project-doc-chapter">
          <h2>
            <span className="project-doc-roman">III.</span> Create your
            character
          </h2>
          <p>
            Sign in and open the dashboard to make your traveler — a name, a
            title, and a short motto for the road. Your purse tracks gold from
            world upvotes and from friends who join with your invite link.
          </p>
          <p>
            <strong>You can:</strong> create a character, copy your referral
            link, earn gold when your lore gets upvotes, and climb the camp
            leaderboard.
          </p>
          <SiteLink className="btn primary btn-glow" href="/dashboard">
            Create your character
          </SiteLink>
        </section>

        <section id="world" className="project-doc-chapter">
          <h2>
            <span className="project-doc-roman">IV.</span> World Archive
          </h2>
          <p>
            The World pages are where travelers leave characters, art, quests,
            dialogue, places, items, rumors, and history. Sign in, publish an
            entry, connect it to other scraps, and let the community upvote
            what sticks.
          </p>
          <p>
            Think of it as a shared codex — not a wiki locked in one author&apos;s
            desk drawer. Good entries rise. The valley gets richer for
            everyone building games and stories with Punaab.
          </p>
          <div className="project-doc-cta-row">
            <SiteLink className="btn primary btn-glow" href="/archive">
              Enter the World Archive
            </SiteLink>
            <SiteLink className="btn soft" href="/archive/characters">
              Browse characters
            </SiteLink>
            <SiteLink className="btn soft" href="/archive/art">
              Browse art
            </SiteLink>
          </div>
        </section>

        <section id="music" className="project-doc-chapter">
          <h2>
            <span className="project-doc-roman">V.</span> Music for the road
          </h2>
          <p>
            Royalty-free tracks for your world. Stream one song or take the
            whole pack. Punaab&apos;s music is open license — use, arrange, and
            perform with credit in the form{" "}
            <code className="project-doc-code">SongTitle - Punaab</code>.
          </p>
          <div className="project-doc-cta-row">
            <SiteLink className="btn primary" href="/music">
              Listen &amp; download
            </SiteLink>
            <a
              className="btn soft"
              href="/downloads/punaab-music.zip"
              download="punaab-music.zip"
            >
              Download all tracks
            </a>
          </div>
        </section>

        <section id="models" className="project-doc-chapter">
          <h2>
            <span className="project-doc-roman">VI.</span> Free 3D models
          </h2>
          <p>
            Static glTF packs of Punaab at 2K, 4K, and 8K — plus his backpack,
            lute, and a reference still. Drop them into Godot, Unity, Unreal,
            or the web. No account required for the meshes.
          </p>
          <SiteLink className="btn primary btn-glow" href="/models">
            Download models
          </SiteLink>
        </section>

        <section id="coin" className="project-doc-chapter">
          <h2>
            <span className="project-doc-roman">VII.</span> Coin &amp; campfire
          </h2>
          <p>
            $PUNAAB on pump.fun is the official coin — a way to back the
            traveling bard and keep the camp lit. Chat lives on X and in our
            Telegram group; code and issues live on GitHub.
          </p>
          <CommunityLinks />
        </section>

        <section id="help" className="project-doc-chapter">
          <h2>
            <span className="project-doc-roman">VIII.</span> How people can help
          </h2>
          <p>
            You do not need to ship a whole game to matter here. Pick one road
            and walk it a little:
          </p>
          <ul className="project-doc-help-list">
            <li>
              <strong>Write lore.</strong> Characters, quests, places, rumors —
              short entries count. Publish in the World Archive and let others
              build on them.
            </li>
            <li>
              <strong>Share art.</strong> Concept pieces, maps, props — upload
              what fits the valley&apos;s tone.
            </li>
            <li>
              <strong>Use the assets.</strong> Put Punaab in a jam, a stream, a
              prototype. Credit the music. Tell us what you made.
            </li>
            <li>
              <strong>Invite friends.</strong> Share your referral link from the
              dashboard. When they join, you earn gold — and they get a seat at
              the fire.
            </li>
            <li>
              <strong>Earn gold.</strong> Upvotes on your World posts pay gold to
              your purse. Climb the homepage leaderboard.
            </li>
            <li>
              <strong>Spread the camp.</strong> Hold $PUNAAB if that is your
              style, invite friends to Telegram, star the repo, post a clip of
              the bard on the road.
            </li>
            <li>
              <strong>Build with the tools.</strong> Sign in for a dashboard
              project when you want API keys and deeper integration — the free
              downloads still work without it.
            </li>
          </ul>
          <div className="project-doc-callout project-doc-callout-end">
            <strong>The short version:</strong> Take freely. Leave something
            behind. Bring a friend to the fire.
          </div>
        </section>

        <footer className="project-doc-end cta-band cta-glow">
          <h2>READY TO BUILD?</h2>
          <p>
            The valley is open. The hall is listening. The pack is packed.
          </p>
          <div className="project-doc-cta-row">
            <SiteLink className="btn primary btn-glow btn-xl" href="/archive">
              Contribute
            </SiteLink>
            <SiteLink className="btn ghost btn-xl" href="/models">
              Free models
            </SiteLink>
            <SiteLink className="btn ghost btn-xl" href="/music">
              Free music
            </SiteLink>
          </div>
        </footer>
      </article>
    </MarketingShell>
  );
}
