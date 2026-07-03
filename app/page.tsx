import PublicHome from "./components/PublicHome";
import {
  buildAgentFollowPrompt,
  fetchPublicMoltbookActivity,
} from "@/lib/public-moltbook";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const activity = await fetchPublicMoltbookActivity();
  const followPrompt = buildAgentFollowPrompt();

  return <PublicHome activity={activity} followPrompt={followPrompt} />;
}
