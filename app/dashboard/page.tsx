import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { CoinWallet } from "@/components/dashboard/CoinWallet";
import { ensureProfile } from "@/lib/profiles";
import { getGoldBalance, GOLD_PER_REFERRAL, GOLD_PER_UPVOTE } from "@/lib/gold";
import { isLoreAdmin } from "@/lib/lore-admin";

const ROAD_ACTIONS = [
  {
    href: "/dashboard/character",
    title: "Character & invites",
    blurb: "Name your traveler, open the purse, share your referral.",
    mark: "I",
  },
  {
    href: "/archive",
    title: "World Archive",
    blurb: "Publish lore, art, quests — earn gold when the camp upvotes you.",
    mark: "II",
  },
  {
    href: "/#leaderboard",
    title: "Earnings board",
    blurb: "See who leads the coffers across the valley.",
    mark: "III",
  },
  {
    href: "/models",
    title: "Free models",
    blurb: "Static GLBs, backpack, lute, and reference still.",
    mark: "IV",
  },
  {
    href: "/music",
    title: "Road music",
    blurb: "CC BY tracks for games, streams, and campfires.",
    mark: "V",
  },
  {
    href: "/dashboard/downloads",
    title: "Downloads",
    blurb: "Grab packs again from your dashboard shelf.",
    mark: "VI",
  },
  {
    href: "/dashboard/embeds",
    title: "Embeds & stream",
    blurb: "Drop Punaab on a site or OBS overlay.",
    mark: "VII",
  },
  {
    href: "/project",
    title: "Project scroll",
    blurb: "What this place is, and how to help it grow.",
    mark: "VIII",
  },
  {
    href: "/account",
    title: "Account",
    blurb: "Profile, billing, and camp settings.",
    mark: "IX",
  },
] as const;

export default async function DashboardPage() {
  const { userId } = await auth();
  const { profile, supabase } = await ensureProfile(userId!);
  const loreAdmin = isLoreAdmin(userId);
  let gold = 0;
  let hasCharacter = false;
  let inviteCount = 0;
  let travelerName: string | null = null;

  if (supabase && profile.id !== "local") {
    const [goldBalance, character, invites] = await Promise.all([
      getGoldBalance(supabase, profile.id),
      supabase
        .from("player_characters")
        .select("profile_id, display_name, title")
        .eq("profile_id", profile.id)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .eq("referred_by", profile.id),
    ]);
    gold = goldBalance;
    hasCharacter = Boolean(character.data);
    travelerName = character.data?.display_name ?? null;
    inviteCount = invites.count ?? 0;
  }

  const actions = loreAdmin
    ? [
        ...ROAD_ACTIONS.slice(0, 2),
        {
          href: "/archive/review",
          title: "Review queue",
          blurb: "Approve pending lore before it enters the Archive.",
          mark: "※",
        },
        ...ROAD_ACTIONS.slice(2),
      ]
    : ROAD_ACTIONS;

  return (
    <DashboardShell
      title="Camp overview"
      subtitle={
        travelerName
          ? `Welcome back, ${travelerName}. Your purse, road, and tools.`
          : "Your traveler's purse, invites, and the roads ahead."
      }
      primaryAction={
        hasCharacter
          ? { href: "/dashboard/character", label: "Open character" }
          : { href: "/dashboard/character", label: "Create character" }
      }
    >
      <div className="dash-overview">
        <CoinWallet
          balance={gold}
          upvoteRate={GOLD_PER_UPVOTE}
          referralRate={GOLD_PER_REFERRAL}
          inviteCount={inviteCount}
          footer={
            <Link className="btn soft coin-wallet-cta" href="/dashboard/character">
              {hasCharacter ? "Open full wallet" : "Create character & wallet"}
            </Link>
          }
        />

        {!hasCharacter ? (
          <article className="dash-callout">
            <p className="dash-callout-mark">New to camp</p>
            <h2>Forge your traveler</h2>
            <p>
              Name yourself, claim a title, and take an invite link. Gold from
              World upvotes and friends who join with your code lands in this
              purse.
            </p>
            <div className="dash-callout-actions">
              <Link className="btn primary" href="/dashboard/character">
                Create character
              </Link>
              <Link className="btn ghost" href="/archive">
                Browse the Archive
              </Link>
            </div>
          </article>
        ) : (
          <article className="dash-callout is-ready">
            <p className="dash-callout-mark">On the road</p>
            <h2>Your ledger is open</h2>
            <p>
              Keep writing lore, share your invite, and climb the earnings
              board. The valley grows with every scrap you leave.
            </p>
            <div className="dash-callout-actions">
              <Link className="btn primary" href="/archive">
                Publish to Archive
              </Link>
              <Link className="btn soft" href="/#leaderboard">
                View board
              </Link>
            </div>
          </article>
        )}
      </div>

      <section className="dash-roadboard" aria-label="Camp tools">
        <header className="dash-roadboard-head">
          <h2>Traveler&apos;s desk</h2>
          <p>Paths from this camp — pick one and walk it.</p>
        </header>
        <ul className="dash-roadboard-grid">
          {actions.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className="dash-road-card">
                <span className="dash-road-mark" aria-hidden="true">
                  {item.mark}
                </span>
                <span className="dash-road-copy">
                  <strong>{item.title}</strong>
                  <span>{item.blurb}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </DashboardShell>
  );
}
