import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { ensureProfile } from "@/lib/profiles";
import { getGoldBalance } from "@/lib/gold";
import { isLoreAdmin } from "@/lib/lore-admin";

export default async function DashboardPage() {
  const { userId } = await auth();
  const { profile, supabase } = await ensureProfile(userId!);
  const loreAdmin = isLoreAdmin(userId);
  let gold = 0;
  let hasCharacter = false;
  let inviteCount = 0;

  if (supabase && profile.id !== "local") {
    const [goldBalance, character, invites] = await Promise.all([
      getGoldBalance(supabase, profile.id),
      supabase
        .from("player_characters")
        .select("profile_id")
        .eq("profile_id", profile.id)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .eq("referred_by", profile.id),
    ]);
    gold = goldBalance;
    hasCharacter = Boolean(character.data);
    inviteCount = invites.count ?? 0;
  }

  return (
    <DashboardShell
      title="Overview"
      subtitle="Your traveler, gold wallet, invites, and worldbuilding."
    >
      <div className="card-grid">
        <article className="card">
          <p className="meta">gold</p>
          <h2>{gold.toLocaleString()}</h2>
          <p>
            From World upvotes and referrals.{" "}
            <Link href="/dashboard/character">Open wallet</Link>
          </p>
        </article>
        <article className="card">
          <p className="meta">invites</p>
          <h2>{inviteCount.toLocaleString()}</h2>
          <p>
            Friends who joined with your referral link.{" "}
            <Link href="/dashboard/character">Copy invite</Link>
          </p>
        </article>
        <article className="card">
          <p className="meta">community</p>
          <h2>Worldbuild</h2>
          <p>
            <Link href="/world">Contribute</Link> so the valley can grow.
            {loreAdmin && (
              <>
                {" "}
                · <Link href="/world/review">Review queue</Link>
              </>
            )}
          </p>
        </article>
      </div>

      {!hasCharacter ? (
        <article className="card empty-state">
          <h2>Create your character</h2>
          <p>
            Name your traveler, grab your invite link, and start earning gold on
            the road.
          </p>
          <div className="hero-actions" style={{ justifyContent: "center" }}>
            <Link className="btn primary" href="/dashboard/character">
              Create character
            </Link>
            <Link className="btn ghost" href="/world">
              Help us world-build
            </Link>
          </div>
        </article>
      ) : (
        <article className="card">
          <h2>What&apos;s next?</h2>
          <ol>
            <li>
              <Link href="/dashboard/character">Invite friends for gold</Link>
            </li>
            <li>
              <Link href="/world">Help us world-build</Link>
            </li>
            <li>
              <Link href="/models">Download free models</Link>
            </li>
            <li>
              <Link href="/music">Download free music</Link>
            </li>
          </ol>
        </article>
      )}
    </DashboardShell>
  );
}
