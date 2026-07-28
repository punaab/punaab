import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { BardDownload } from "@/components/downloads/BardDownload";

export const metadata = {
  title: "Downloads · Punaab",
  description:
    "Download Punaab the traveling bard as a glTF model for Godot, Unity, Unreal and the web.",
};

export default function DownloadsPage() {
  return (
    <DashboardShell
      title="Downloads"
      subtitle="Free models for your game or story."
    >
      <article className="card">
        <p className="meta">3D model · GLB</p>
        <h2>Punaab the traveling bard</h2>
        <p>
          Static glTF meshes at 2K, 4K, and 8K — plus the backpack, lute, and a
          reference still. Drop them into Godot, Unity, Unreal, or the web.
        </p>
        <BardDownload />
      </article>
    </DashboardShell>
  );
}
