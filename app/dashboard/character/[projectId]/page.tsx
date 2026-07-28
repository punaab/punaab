import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { CharacterBuilder } from "@/components/character-builder/CharacterBuilder";
import { ensureProfile } from "@/lib/profiles";

export default async function CharacterPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { userId } = await auth();
  const { profile, supabase } = await ensureProfile(userId!);
  if (!supabase || profile.id === "local") notFound();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .eq("owner_id", profile.id)
    .maybeSingle();
  if (!project) notFound();

  return (
    <DashboardShell
      title={`Character · ${project.name}`}
      subtitle="Configure the bard this project drops into the game."
    >
      <CharacterBuilder projectId={projectId} />
    </DashboardShell>
  );
}
