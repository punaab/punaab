"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Character = {
  display_name: string;
  title: string;
  motto: string;
  instrument: string;
};

type Wallet = {
  balance: number;
  referralCode: string | null;
  invitePath: string | null;
  inviteUrl: string | null;
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
  const [copied, setCopied] = useState(false);

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
          referralCode: goldData.referralCode ?? null,
          invitePath: goldData.invitePath ?? null,
          inviteUrl: goldData.inviteUrl ?? null,
          rates: goldData.rates ?? { upvote: 5, referral: 50 },
        });
      })
      .catch(() => setStatus("Could not load your traveler."));
  }, []);

  const inviteUrl =
    wallet?.inviteUrl ??
    (wallet?.invitePath ? `https://punaab.com${wallet.invitePath}` : null);
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
      setStatus("Character saved. Welcome to the road.");
      router.refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function copyInvite() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setStatus("Could not copy — select the link and copy manually.");
    }
  }

  return (
    <div className="player-studio">
      <article className="card player-wallet-card">
        <p className="meta">gold wallet</p>
        <h2 className="player-gold-balance">
          {(wallet?.balance ?? 0).toLocaleString()}{" "}
          <span className="player-gold-unit">gold</span>
        </h2>
        <p>
          Earn {wallet?.rates.upvote ?? 5} gold when someone upvotes your World
          posts. Earn {wallet?.rates.referral ?? 50} gold when a friend joins
          with your invite.
        </p>
      </article>

      <article className="card">
        <h2>Your traveler</h2>
        <p className="player-studio-lead">
          This is your character on Punaab — shown on the gold leaderboard when
          you climb the ranks.
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
          />
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
          <label htmlFor="traveler-instrument">Weapon/Instrument (x1)</label>
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
          {busy ? "Saving…" : "Save character"}
        </button>
        {status ? <p className="player-studio-status">{status}</p> : null}
      </article>

      <article className="card">
        <h2>Invite friends</h2>
        <p>
          Share your link. When they sign up, you earn gold — and the camp
          grows.
        </p>
        <div className="player-invite-box">
          <code>{inviteUrl || "Loading invite…"}</code>
          <button
            type="button"
            className="btn soft"
            onClick={() => void copyInvite()}
            disabled={!inviteUrl}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
        {wallet?.referralCode ? (
          <p className="meta">Code: {wallet.referralCode}</p>
        ) : null}
      </article>
    </div>
  );
}
