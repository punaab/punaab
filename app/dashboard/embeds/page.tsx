import { auth } from "@clerk/nextjs/server";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import {
  EmbedManager,
  type BridgeRow,
  type EmbedTokenRow,
} from "@/components/dashboard/EmbedManager";
import { getShareAppUrl } from "@/lib/app-url";
import { capabilitiesFor } from "@/lib/plans";
import { ensureProfile } from "@/lib/profiles";

export const metadata = {
  title: "Embeds · Punaab",
  description:
    "Embed Punaab on your website, add him to OBS as a stream overlay, and bridge Twitch and Kick chat.",
};

export default async function EmbedsPage() {
  const { userId } = await auth();
  const { profile, supabase } = await ensureProfile(userId!);

  let projects: Array<{ id: string; name: string }> = [];
  let tokens: EmbedTokenRow[] = [];
  let bridges: BridgeRow[] = [];

  if (supabase && profile.id !== "local") {
    const { data: projectRows } = await supabase
      .from("projects")
      .select("id, name")
      .eq("owner_id", profile.id)
      .order("created_at", { ascending: false });
    projects = projectRows || [];

    const ids = projects.map((project) => project.id);
    if (ids.length) {
      const [{ data: tokenRows }, { data: bridgeRows }] = await Promise.all([
        supabase
          .from("embed_tokens")
          .select(
            "id, project_id, name, token, allowed_origins, surface, daily_credit_cap, enabled, last_used_at"
          )
          .in("project_id", ids)
          .is("revoked_at", null)
          .order("created_at", { ascending: false }),
        supabase
          .from("chat_bridges")
          .select(
            "id, project_id, platform, channel, respond_mode, trigger_prefix, cooldown_seconds"
          )
          .in("project_id", ids),
      ]);
      tokens = (tokenRows as EmbedTokenRow[]) || [];
      bridges = (bridgeRows as BridgeRow[]) || [];
    }
  }

  // Snippets have to carry an absolute URL — they run on somebody else's site,
  // where a relative path would resolve against their domain.
  const appOrigin = getShareAppUrl();

  return (
    <DashboardShell
      title="Embeds & Streaming"
      subtitle="Put Punaab on your site, in your stream, and in your chat."
    >
      <EmbedManager
        projects={projects}
        tokens={tokens}
        bridges={bridges}
        capabilities={capabilitiesFor(profile.plan_code)}
        appOrigin={appOrigin}
      />
    </DashboardShell>
  );
}
