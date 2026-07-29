import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { CoinWallet } from "@/components/dashboard/CoinWallet";
import { ensureProfile } from "@/lib/profiles";
import { getGoldBalance } from "@/lib/gold";
import { isLoreAdmin } from "@/lib/lore-admin";

const ROAD_ACTIONS = [
  {
    href: "/dashboard/ledger",
    title: "Ledger",
    blurb: "Purse, passport, guild tools.",
    mark: "✦",
  },
  {
    href: "/dashboard/rewards",
    title: "Rewards",
    blurb: "Invite friends. Earn gold.",
    mark: "◎",
  },
  {
    href: "/archive",
    title: "Archive",
    blurb: "Publish lore. Earn upvotes.",
    mark: "※",
  },
  {
    href: "/#leaderboard",
    title: "Board",
    blurb: "See who leads the coffers.",
    mark: "♛",
  },
  {
    href: "/models",
    title: "Models",
    blurb: "Free GLBs for your game.",
    mark: "◇",
  },
  {
    href: "/music",
    title: "Music",
    blurb: "CC BY tracks for the road.",
    mark: "♪",
  },
  {
    href: "/project",
    title: "Project",
    blurb: "What this place is about.",
    mark: "▣",
  },
  {
    href: "/account",
    title: "Account",
    blurb: "Profile and guild settings.",
    mark: "⛨",
  },
] as const;

export default async function DashboardPage() {
  const { userId } = await auth();
  const { profile, supabase } = await ensureProfile(userId!);
  const loreAdmin = await isLoreAdmin(userId);
  let gold = 0;
  let hasCharacter = false;
  let travelerName: string | null = null;

  if (supabase && profile.id !== "local") {
    const [goldBalance, character] = await Promise.all([
      getGoldBalance(supabase, profile.id),
      supabase
        .from("player_characters")
        .select("profile_id, display_name, title")
        .eq("profile_id", profile.id)
        .maybeSingle(),
    ]);
    gold = goldBalance;
    hasCharacter = Boolean(character.data);
    travelerName = character.data?.display_name ?? null;
  }

  const actions = loreAdmin
    ? [
        ...ROAD_ACTIONS.slice(0, 2),
        {
          href: "/admin",
          title: "Admin",
          blurb: "Approve Archive submissions.",
          mark: "⚖",
        },
        ...ROAD_ACTIONS.slice(2),
      ]
    : ROAD_ACTIONS;

  return (
    <DashboardShell
      title="Guild overview"
      subtitle={
        travelerName
          ? `Welcome back, ${travelerName}. Your purse, road, and guild tools.`
          : "Your traveler's purse, invites, and the roads ahead."
      }
      primaryAction={{ href: "/dashboard/ledger", label: "OPEN LEDGER" }}
    >
      <div className="dash-overview">
        <CoinWallet
          balance={gold}
          footer={
            <Link className="btn soft coin-wallet-cta" href="/dashboard/ledger">
              {hasCharacter ? "Open full ledger" : "Open ledger & passport"}
            </Link>
          }
        />

        {!hasCharacter ? (
          <article className="dash-callout">
            <p className="dash-callout-mark">New to the guild</p>
            <h2>Forge your passport</h2>
            <p>
              Name yourself, claim a title, and take an invite scroll. Gold from
              Archive upvotes and friends who join with your code lands in this
              purse.
            </p>
            <div className="dash-callout-actions">
              <Link className="btn primary" href="/dashboard/ledger">
                Open ledger
              </Link>
              <Link className="btn soft" href="/dashboard/rewards">
                Invite scroll
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
              <Link className="btn soft" href="/dashboard/rewards">
                Share invite
              </Link>
              <Link className="btn soft" href="/archive">
                View board
              </Link>
            </div>
          </article>
        )}
      </div>

      <section className="dash-roadboard" aria-label="Guild tools">
        <header className="dash-roadboard-head">
          <h2>Guild desk</h2>
          <p>Paths from this camp — pick one and walk it.</p>
        </header>
        <ul className="dash-roadboard-grid">
          {actions.map((item) => (
            <li key={`${item.title}-${item.href}`}>
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
