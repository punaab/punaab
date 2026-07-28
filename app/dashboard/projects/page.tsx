import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { CreateProjectForm } from "@/components/dashboard/CreateProjectForm";
import { ensureProfile } from "@/lib/profiles";

export default async function ProjectsPage() {
  const { userId } = await auth();
  const { profile, supabase } = await ensureProfile(userId!);

  let projects: Array<{ id: string; name: string; mode: string; created_at: string }> = [];
  if (supabase && profile.id !== "local") {
    const { data } = await supabase
      .from("projects")
      .select("id, name, mode, created_at")
      .eq("owner_id", profile.id)
      .order("created_at", { ascending: false });
    projects = data || [];
  }

  return (
    <DashboardShell title="Projects" subtitle="One project = one game integration.">
      <CreateProjectForm />
      <div className="card-grid">
        {projects.map((p) => (
          <Link key={p.id} href={`/dashboard/projects/${p.id}`} className="card">
            <p className="meta">{p.mode}</p>
            <h2>{p.name}</h2>
            <p>Open settings, keys, and character config.</p>
          </Link>
        ))}
      </div>
    </DashboardShell>
  );
}
