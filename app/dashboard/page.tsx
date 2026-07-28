import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { ensureProfile } from "@/lib/profiles";
import { getCreditBalance } from "@/lib/credits";

export default async function DashboardPage() {
  const { userId } = await auth();
  const { profile, supabase } = await ensureProfile(userId!);
  let projectCount = 0;
  let credits = 500;

  if (supabase && profile.id !== "local") {
    const [{ count }, balance] = await Promise.all([
      supabase
        .from("projects")
        .select("*", { count: "exact", head: true })
        .eq("owner_id", profile.id),
      getCreditBalance(supabase, profile.id),
    ]);
    projectCount = count ?? 0;
    credits = balance;
  }

  return (
    <DashboardShell
      title="Overview"
      subtitle="Drop Punaab into your game in under five minutes."
    >
      <div className="card-grid">
        <article className="card">
          <p className="meta">plan</p>
          <h2>{profile.plan_code}</h2>
          <p>Your current subscription tier.</p>
        </article>
        <article className="card">
          <p className="meta">credits</p>
          <h2>{credits.toLocaleString()}</h2>
          <p>Cloud AI and music burn credits. Local AI does not.</p>
        </article>
        <article className="card">
          <p className="meta">projects</p>
          <h2>{projectCount}</h2>
          <p>Each project gets its own API key and bard config.</p>
        </article>
      </div>

      {projectCount === 0 ? (
        <article className="card empty-state">
          <h2>Create your first project</h2>
          <p>
            Next step: make a project, copy an API key, download the Godot
            plugin, paste the key, and hit play.
          </p>
          <div className="hero-actions" style={{ justifyContent: "center" }}>
            <Link className="btn primary" href="/dashboard/projects">
              Create project
            </Link>
            <Link className="btn ghost" href="/docs/getting-started">
              Getting started
            </Link>
          </div>
        </article>
      ) : (
        <article className="card">
          <h2>What&apos;s next?</h2>
          <ol>
            <li>
              <Link href="/dashboard/downloads">Download the Godot plugin</Link>
            </li>
            <li>
              <Link href="/dashboard/keys">Copy an API key</Link>
            </li>
            <li>
              <Link href="/docs/godot">Paste it into the Punaab node</Link>
            </li>
          </ol>
        </article>
      )}
    </DashboardShell>
  );
}
