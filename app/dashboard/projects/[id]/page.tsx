import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { CreateKeyForm } from "@/components/dashboard/CreateKeyForm";
import { RevokeKeyButton } from "@/components/dashboard/RevokeKeyButton";
import { ensureProfile } from "@/lib/profiles";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { userId } = await auth();
  const { profile, supabase } = await ensureProfile(userId!);
  if (!supabase || profile.id === "local") notFound();

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .eq("owner_id", profile.id)
    .maybeSingle();
  if (!project) notFound();

  const { data: keys } = await supabase
    .from("api_keys")
    .select("id, name, key_prefix, created_at, revoked_at, last_used_at")
    .eq("project_id", id)
    .order("created_at", { ascending: false });

  return (
    <DashboardShell title={project.name} subtitle={`Mode: ${project.mode}`}>
      <div className="card-grid">
        <article className="card">
          <h2>Next steps</h2>
          <ol>
            <li>Generate an API key below</li>
            <li>
              <Link href="/models">Download free models</Link>
            </li>
            <li>
              <Link href={`/dashboard/character/${id}`}>Configure Punaab</Link>
            </li>
          </ol>
        </article>
        <article className="card">
          <h2>Character</h2>
          <p>Loadout and merchant defaults.</p>
          <Link className="btn soft" href={`/dashboard/character/${id}`}>
            Open builder
          </Link>
        </article>
      </div>

      <CreateKeyForm projectId={id} />

      <article className="card">
        <h2>API keys</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Prefix</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(keys || []).map((k) => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td>
                  <code>{k.key_prefix}…</code>
                </td>
                <td>{k.revoked_at ? "revoked" : "active"}</td>
                <td>
                  {!k.revoked_at ? <RevokeKeyButton keyId={k.id} /> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
    </DashboardShell>
  );
}
