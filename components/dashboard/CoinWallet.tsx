import type { ReactNode } from "react";

type CoinWalletProps = {
  balance: number;
  upvoteRate?: number;
  referralRate?: number;
  inviteCount?: number | null;
  loading?: boolean;
  /** Compact for grids; full for ledger page. */
  size?: "full" | "compact";
  footer?: ReactNode;
};

/**
 * Shared medieval coin-purse / wallet used on Overview and Ledger.
 */
export function CoinWallet({
  balance,
  upvoteRate = 5,
  referralRate = 50,
  inviteCount = null,
  loading = false,
  size = "full",
  footer,
}: CoinWalletProps) {
  return (
    <aside
      className={`coin-wallet${size === "compact" ? " is-compact" : ""}`}
      aria-label="Gold wallet"
    >
      <div className="coin-wallet-flap" aria-hidden="true">
        <span className="coin-wallet-clasp" />
      </div>

      <div className="coin-wallet-inner">
        <div className="coin-wallet-label">
          <span className="coin-wallet-seal" aria-hidden="true">
            ✦
          </span>
          Traveler&apos;s purse
        </div>

        <div className="coin-wallet-stack">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/assets/images/pixel_coin.svg"
            alt=""
            className="coin-wallet-coin"
            width={72}
            height={72}
          />
          <div className="coin-wallet-sum">
            <p className="coin-wallet-meta">Gold on hand</p>
            <p className="coin-wallet-balance">
              {loading ? "…" : balance.toLocaleString()}
              <em>gold</em>
            </p>
          </div>
        </div>

        <ul className="coin-wallet-rates">
          <li>
            <strong>+{upvoteRate}</strong>
            <span>per World upvote</span>
          </li>
          <li>
            <strong>+{referralRate}</strong>
            <span>per invite signup</span>
          </li>
          {inviteCount != null ? (
            <li>
              <strong>{inviteCount.toLocaleString()}</strong>
              <span>friends joined</span>
            </li>
          ) : null}
        </ul>

        {footer ? <div className="coin-wallet-foot">{footer}</div> : null}
      </div>
    </aside>
  );
}
