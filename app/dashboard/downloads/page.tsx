import Link from "next/link";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { BardDownload } from "@/components/downloads/BardDownload";

export const metadata = {
  title: "Downloads · Punaab",
  description:
    "Download Punaab the traveling bard as a glTF model for Godot, Unity, Unreal and the web, plus the engine plugins.",
};

export default function DownloadsPage() {
  return (
    <DashboardShell
      title="Downloads"
      subtitle="Take the bard with you — model first, then the engine plugins."
    >
      <article className="card">
        <p className="meta">3D model · glTF 2.0</p>
        <h2>Punaab the traveling bard</h2>
        <p>
          The same character walking the valley on the homepage, exported to a
          standard glTF file your engine already knows how to read. Pick a
          format and it is generated in your browser.
        </p>
        <BardDownload />
      </article>

      <article className="card">
        <p className="meta">godot 4</p>
        <h2>Punaab Godot Plugin 0.1.0</h2>
        <p>
          Drop the addon into your project, add the Punaab node, paste your API
          key, run. Wires the model above to dialogue, music and the merchant.
        </p>
        <div className="hero-actions">
          <a className="btn primary" href="/downloads/punaab-godot-0.1.0.zip">
            Download ZIP
          </a>
          <Link className="btn ghost" href="/docs/godot">
            Godot docs
          </Link>
        </div>
      </article>

      <article className="card">
        <h3>Engine plugins coming next</h3>
        <p>Unity · Unreal · Roblox · Babylon · Bevy · Phaser</p>
        <p className="bard-field-note">
          The model above already works in all of them today — these are the
          convenience wrappers that connect it to the Punaab API.
        </p>
      </article>
    </DashboardShell>
  );
}
