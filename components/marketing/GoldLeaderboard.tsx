"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { SiteLink } from "@/components/marketing/SiteLink";

type Leader = {
  profileId: string;
  displayName: string;
  title?: string | null;
  gold: number;
};

export function GoldLeaderboard() {
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [hasCharacter, setHasCharacter] = useState<boolean | null>(null);

  useEffect(() => {
    void fetch("/api/community/gold/leaderboard", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { leaders: [] }))
      .then((data: { leaders?: Leader[] }) => {
        setLeaders(data.leaders ?? []);
      })
      .catch(() => setLeaders([]))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!authLoaded) return;
    if (!isSignedIn) {
      // Guests still see the invite to create.
      setHasCharacter(false);
      return;
    }

    let cancelled = false;
    void fetch("/api/v1/player-character", {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (r) => {
        // Only treat a successful empty payload as "no character".
        // Auth/API errors must not resurface the create card for someone
        // who already made a traveler in the dashboard.
        if (!r.ok) return;
        const data = (await r.json()) as { character?: { display_name?: string } | null };
        if (cancelled) return;
        setHasCharacter(Boolean(data.character?.display_name));
      })
      .catch(() => {
        /* leave null — hide create until we know */
      });

    return () => {
      cancelled = true;
    };
  }, [authLoaded, isSignedIn]);

  // Only when we know there is no character (guest, or signed-in with none).
  // Loading / unknown → stay hidden so existing players never see a false invite.
  const showCreate = hasCharacter === false;

  return (
    <section id="leaderboard" className="section gold-board">
      <h2>World Earnings Board</h2>
      <p className="section-lead">
        Ranked by gold earned from World upvotes and invites. Names are the
        characters travelers create.
      </p>

      {!loaded ? (
        <p className="gold-board-empty">Counting the coffers…</p>
      ) : leaders.length === 0 ? (
        <p className="gold-board-empty">No travelers on the board yet.</p>
      ) : (
        <ol className="gold-board-list">
          {leaders.map((row, index) => (
            <li key={row.profileId} className="gold-board-row">
              <span className="gold-board-rank">{index + 1}</span>
              <div className="gold-board-who">
                <strong>{row.displayName}</strong>
                {row.title ? <span>{row.title}</span> : null}
              </div>
              <span className="gold-board-amount">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/assets/images/pixel_coin.svg"
                  alt=""
                  className="gold-board-coin"
                  width={22}
                  height={22}
                />
                {row.gold.toLocaleString()} <em>gold</em>
              </span>
            </li>
          ))}
        </ol>
      )}

      {showCreate && (
        <div className="gold-board-empty-card">
          <p>Create your character to start earning your place on the board.</p>
          <SiteLink className="btn primary" href="/dashboard/character">
            Create your character
          </SiteLink>
        </div>
      )}

      <div className="gold-board-actions">
        {hasCharacter === true && (
          <SiteLink className="btn soft" href="/dashboard/character">
            Open wallet &amp; invites
          </SiteLink>
        )}
        <SiteLink className="btn soft" href="/world">
          Earn gold in World
        </SiteLink>
      </div>
    </section>
  );
}
