"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { GOLD_PER_REFERRAL, GOLD_PER_UPVOTE } from "@/lib/gold";

type Wallet = {
  balance: number;
  referralCode: string | null;
  invitePath: string | null;
  inviteUrl: string | null;
  rates: { upvote: number; referral: number };
};

/**
 * Guild rewards scroll — the invite seal and how gold enters the purse.
 */
export function InviteScroll() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetch("/api/v1/gold")
      .then((r) => r.json())
      .then((goldData) => {
        setWallet({
          balance: Number(goldData.balance ?? 0),
          referralCode: goldData.referralCode ?? null,
          invitePath: goldData.invitePath ?? null,
          inviteUrl: goldData.inviteUrl ?? null,
          rates: goldData.rates ?? {
            upvote: GOLD_PER_UPVOTE,
            referral: GOLD_PER_REFERRAL,
          },
        });
      })
      .catch(() => setStatus("Could not unfurl your invite scroll."))
      .finally(() => setLoading(false));
  }, []);

  const inviteUrl =
    wallet?.inviteUrl ??
    (wallet?.invitePath ? `https://www.punaab.com${wallet.invitePath}` : null);

  const upvote = wallet?.rates.upvote ?? GOLD_PER_UPVOTE;
  const referral = wallet?.rates.referral ?? GOLD_PER_REFERRAL;

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
    <div className="guild-rewards">
      <section className="invite-scroll" aria-labelledby="invite-scroll-title">
        <div className="invite-scroll-roll invite-scroll-roll-top" aria-hidden="true" />
        <div className="invite-scroll-body">
          <div className="invite-scroll-seal" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/assets/images/pixel_coin.svg"
              alt=""
              className="invite-scroll-coin"
              width={72}
              height={72}
            />
          </div>

          <p className="invite-scroll-eyebrow">Guild seal · Invite scroll</p>
          <h2 id="invite-scroll-title">Call travelers to the road</h2>
          <p className="invite-scroll-lead">
            Share this link. Friends who join add gold to your purse.
          </p>

          <div className="invite-scroll-bounty" aria-label="Reward rates">
            <div className="invite-scroll-bounty-cell">
              <strong>+{referral}</strong>
              <span>gold per invite</span>
            </div>
            <div className="invite-scroll-bounty-cell">
              <strong>+{upvote}</strong>
              <span>gold per Archive upvote</span>
            </div>
            <div className="invite-scroll-bounty-cell">
              <strong>
                {loading ? "…" : (wallet?.balance ?? 0).toLocaleString()}
              </strong>
              <span>gold on hand</span>
            </div>
          </div>

          <div className="invite-scroll-linkbox">
            <p className="invite-scroll-link-label">Your sealed link</p>
            <code>
              {inviteUrl || (loading ? "Unfurling…" : "Sign in to claim a seal")}
            </code>
            <div className="invite-scroll-actions">
              <button
                type="button"
                className="btn primary"
                onClick={() => void copyInvite()}
                disabled={!inviteUrl}
              >
                {copied ? "Copied" : "Copy invite link"}
              </button>
              <Link className="btn soft" href="/dashboard/ledger">
                Ledger
              </Link>
            </div>
          </div>

          {wallet?.referralCode ? (
            <p className="invite-scroll-code">
              Guild code <kbd>{wallet.referralCode}</kbd>
            </p>
          ) : null}

          {status ? <p className="invite-scroll-status">{status}</p> : null}
        </div>
        <div className="invite-scroll-roll invite-scroll-roll-bottom" aria-hidden="true" />
      </section>

      <section className="guild-earn-board" aria-label="Ways to earn">
        <header>
          <h2>Ways to fill the purse</h2>
          <p>Three roads into gold — walk whichever fits the day.</p>
        </header>
        <ul>
          <li>
            <span className="guild-earn-mark" aria-hidden="true">
              I
            </span>
            <div>
              <strong>Invite scroll</strong>
              <p>
                Share your sealed link. Each signup pays{" "}
                <em>+{referral} gold</em>.
              </p>
            </div>
          </li>
          <li>
            <span className="guild-earn-mark" aria-hidden="true">
              II
            </span>
            <div>
              <strong>Archive upvotes</strong>
              <p>
                Publish lore, art, or quests. The camp pays{" "}
                <em>+{upvote} gold</em> per upvote.
              </p>
              <Link className="btn soft" href="/archive">
                Open the Archive
              </Link>
            </div>
          </li>
          <li>
            <span className="guild-earn-mark" aria-hidden="true">
              III
            </span>
            <div>
              <strong>Earnings board</strong>
              <p>Climb the coffers and see who leads the guild.</p>
              <Link className="btn soft" href="/#leaderboard">
                View the board
              </Link>
            </div>
          </li>
        </ul>
      </section>
    </div>
  );
}
