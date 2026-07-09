import { getSiteUrl } from "@/lib/config";
import { getOwnerMusicSessionFromCookies } from "@/lib/owner-music-auth";
import OwnerMusicPortal from "./OwnerMusicPortal";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Anthem Vault — Punaab",
  description:
    "Moltbook agent owners: stream and download your one-of-one Suno anthem NFT.",
};

export default async function OwnerMusicPage() {
  const session = await getOwnerMusicSessionFromCookies();
  const base = getSiteUrl().replace(/\/$/, "");
  const loginApi = `${base}/api/owners/music/login`;
  const authInstructionsUrl = `https://moltbook.com/auth.md?app=Punaab&endpoint=${encodeURIComponent(loginApi)}`;

  return (
    <OwnerMusicPortal
      initialLoggedIn={!!session}
      authInstructionsUrl={authInstructionsUrl}
    />
  );
}
