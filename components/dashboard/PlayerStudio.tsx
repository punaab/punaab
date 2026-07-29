"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CoinWallet } from "@/components/dashboard/CoinWallet";

type Character = {
  display_name: string;
  title: string;
  motto: string;
  instrument: string;
};

type Wallet = {
  balance: number;
  rates: { upvote: number; referral: number };
};

export function PlayerStudio() {
  const router = useRouter();
  const [character, setCharacter] = useState<Character>({
    display_name: "",
    title: "Traveler",
    motto: "",
    instrument: "lute",
  });
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [walletLoading, setWalletLoading] = useState(true);

  useEffect(() => {
    void Promise.all([
      fetch("/api/v1/player-character").then((r) => r.json()),
      fetch("/api/v1/gold").then((r) => r.json()),
    ])
      .then(([charData, goldData]) => {
        if (charData.character) {
          setCharacter({
            display_name: charData.character.display_name || "",
            title: charData.character.title || "Traveler",
            motto: charData.character.motto || "",
            instrument: charData.character.instrument || "lute",
          });
        }
        setWallet({
          balance: Number(goldData.balance ?? 0),
          rates: goldData.rates ?? { upvote: 5, referral: 50 },
        });
      })
      .catch(() => setStatus("Could not load your ledger."))
      .finally(() => setWalletLoading(false));
  }, []);

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/v1/player-character", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(character),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setStatus("Passport updated. The guild records your name.");
      router.refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="player-studio">
      <CoinWallet
        balance={wallet?.balance ?? 0}
        upvoteRate={wallet?.rates.upvote}
        referralRate={wallet?.rates.referral}
        loading={walletLoading}
        footer={
          <p className="coin-wallet-hint">
            Gold from Archive upvotes and guild invites lands here. Share your
            scroll on Rewards to earn more.
          </p>
        }
      />

      <article className="card player-traveler-card">
        <p className="meta">Guild passport</p>
        <h2>Update your papers</h2>
        <p className="player-studio-lead">
          Your name on the Earnings Board and across the camp. Names must be
          unique — no two travelers share a seal.
        </p>
        <div className="form-row">
          <label htmlFor="traveler-name">Name</label>
          <input
            id="traveler-name"
            value={character.display_name}
            onChange={(e) =>
              setCharacter((c) => ({ ...c, display_name: e.target.value }))
            }
            placeholder="Ash of the Meadow Road"
            maxLength={48}
            autoComplete="off"
            aria-describedby="traveler-name-hint"
          />
          <p id="traveler-name-hint" className="meta">
            2–48 characters. No two travelers may share a name.
          </p>
        </div>
        <div className="form-row">
          <label htmlFor="traveler-title">Title</label>
          <input
            id="traveler-title"
            value={character.title}
            onChange={(e) =>
              setCharacter((c) => ({ ...c, title: e.target.value }))
            }
            placeholder="Wandering bard"
            maxLength={48}
          />
        </div>
        <div className="form-row">
          <label htmlFor="traveler-motto">Motto</label>
          <textarea
            id="traveler-motto"
            rows={2}
            value={character.motto}
            onChange={(e) =>
              setCharacter((c) => ({ ...c, motto: e.target.value }))
            }
            placeholder="Songs for supper, stories for the road."
            maxLength={160}
          />
        </div>
        <div className="form-row">
          <label htmlFor="traveler-instrument">Weapon / instrument</label>
          <input
            id="traveler-instrument"
            value={character.instrument}
            onChange={(e) =>
              setCharacter((c) => ({ ...c, instrument: e.target.value }))
            }
            placeholder="lute"
            maxLength={40}
          />
        </div>
        <button
          type="button"
          className="btn primary"
          onClick={() => void save()}
          disabled={busy || character.display_name.trim().length < 2}
        >
          {busy ? "Sealing…" : "Update passport"}
        </button>
        {status ? <p className="player-studio-status">{status}</p> : null}
      </article>

      <section className="guild-desk" aria-label="Guild desk">
        <header className="guild-desk-head">
          <p className="meta">Guild desk</p>
          <h2>Work of the camp</h2>
          <p>Paths that fill the ledger — publish, invite, climb.</p>
        </header>
        <ul className="guild-desk-grid">
          <li>
            <Link href="/dashboard/rewards" className="guild-desk-card">
              <span className="guild-desk-mark" aria-hidden="true">
                ✦
              </span>
              <strong>Invite scroll</strong>
              <span>Share your sealed link and earn gold per signup.</span>
            </Link>
          </li>
          <li>
            <Link href="/archive" className="guild-desk-card">
              <span className="guild-desk-mark" aria-hidden="true">
                II
              </span>
              <strong>World Archive</strong>
              <span>Write lore and art — upvotes pay into this purse.</span>
            </Link>
          </li>
          <li>
            <Link href="/#leaderboard" className="guild-desk-card">
              <span className="guild-desk-mark" aria-hidden="true">
                III
              </span>
              <strong>Earnings board</strong>
              <span>See who leads the coffers across the valley.</span>
            </Link>
          </li>
          <li>
            <Link href="/world" className="guild-desk-card" target="_blank" rel="noopener noreferrer">
              <span className="guild-desk-mark" aria-hidden="true">
                IV
              </span>
              <strong>Land of Pixelgrew</strong>
              <span>Walk the stage — the living road of the guild.</span>
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
