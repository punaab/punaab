import type { ReactNode } from "react";

type CoinWalletProps = {
  balance: number;
  loading?: boolean;
  /** Compact for grids; full for ledger page. */
  size?: "full" | "compact";
  footer?: ReactNode;
  /**
   * Ledger stats. Omit on overview — rates and invite tallies live on Ledger
   * / Rewards, not the camp overview purse.
   */
  inviteCount?: number | null;
  lifetimeEarned?: number | null;
};

/**
 * Shared medieval coin-purse used on Overview and Ledger.
 */
export function CoinWallet({
  balance,
  loading = false,
  size = "full",
  footer,
  inviteCount = null,
  lifetimeEarned = null,
}: CoinWalletProps) {
  const showLedgerStats = inviteCount != null || lifetimeEarned != null;

  return (
    <aside
      className={`coin-wallet${size === "compact" ? " is-compact" : ""}`}
      aria-label="Traveler's purse"
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

        {showLedgerStats ? (
          <ul className="coin-wallet-rates">
            {lifetimeEarned != null ? (
              <li>
                <strong>
                  {loading ? "…" : lifetimeEarned.toLocaleString()}
                </strong>
                <span>amount earned</span>
              </li>
            ) : null}
            {inviteCount != null ? (
              <li>
                <strong>
                  {loading ? "…" : inviteCount.toLocaleString()}
                </strong>
                <span>friends joined</span>
              </li>
            ) : null}
          </ul>
        ) : null}

        {footer ? <div className="coin-wallet-foot">{footer}</div> : null}
      </div>
    </aside>
  );
}
