import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { CreateKeyForm } from "@/components/dashboard/CreateKeyForm";
import { RevokeKeyButton } from "@/components/dashboard/RevokeKeyButton";
import { ensureProfile } from "@/lib/profiles";

export default async function KeysPage() {
  const { userId } = await auth();
  const { profile, supabase } = await ensureProfile(userId!);

  let projects: Array<{ id: string; name: string }> = [];
  let keys: Array<{
    id: string;
    name: string;
    key_prefix: string;
    project_id: string;
    revoked_at: string | null;
  }> = [];

  if (supabase && profile.id !== "local") {
    const { data: p } = await supabase
      .from("projects")
      .select("id, name")
      .eq("owner_id", profile.id);
    projects = p || [];
    const ids = projects.map((x) => x.id);
    if (ids.length) {
      const { data: k } = await supabase
        .from("api_keys")
        .select("id, name, key_prefix, project_id, revoked_at")
        .in("project_id", ids)
        .order("created_at", { ascending: false });
      keys = k || [];
    }
  }

  const firstProject = projects[0]?.id;

  return (
    <DashboardShell
      title="API Keys"
      subtitle="Runtime keys for Godot and future engines."
    >
      {!firstProject ? (
        <article className="card empty-state">
          <h2>Create a project first</h2>
          <p>Keys are scoped to a project.</p>
          <Link className="btn primary" href="/dashboard/projects">
            Create project
          </Link>
        </article>
      ) : (
        <CreateKeyForm projectId={firstProject} />
      )}

      <article className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Prefix</th>
              <th>Project</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td>
                  <code>{k.key_prefix}…</code>
                </td>
                <td>
                  {projects.find((p) => p.id === k.project_id)?.name || k.project_id}
                </td>
                <td>{k.revoked_at ? "revoked" : "active"}</td>
                <td>{!k.revoked_at ? <RevokeKeyButton keyId={k.id} /> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
    </DashboardShell>
  );
}
