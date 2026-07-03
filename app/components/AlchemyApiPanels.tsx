"use client";

import { useState } from "react";
import type { AlchemyApiSnapshot } from "@/lib/alchemy-apis";
import { txExplorerUrl } from "@/lib/web3-dashboard";

function shortAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr || "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function chainExplorerKey(network: string): string {
  if (network.includes("solana")) return "solana";
  if (network.includes("base")) return "base";
  return "ethereum";
}

function timeAgo(iso: string | undefined): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface Props {
  data: AlchemyApiSnapshot | null | undefined;
  onRefresh?: () => void;
}

export default function AlchemyApiPanels({ data, onRefresh }: Props) {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");

  if (!data) return null;

  async function forceRefresh() {
    setRefreshing(true);
    setRefreshError("");
    try {
      const res = await fetch("/api/admin/alchemy/refresh", { method: "POST" });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setRefreshError(body.error ?? "Refresh failed");
        return;
      }
      onRefresh?.();
    } catch {
      setRefreshError("Could not refresh Alchemy data");
    } finally {
      setRefreshing(false);
    }
  }

  const portfolioCount = data.portfolio.tokens.length;
  const nftCount = data.nfts.totalCount || data.nfts.items.length;
  const tokenCount = data.tokens.items.length;
  const transferCount = data.transfers.items.length;

  return (
    <div className="alchemy-apis">
      <div className="alchemy-apis-header">
        <div>
          <h3 className="web3-panel-title">Alchemy Data APIs</h3>
          <p className="muted web3-panel-hint">
            Portfolio · NFT · Token · Transfers — cached {data.cacheSec}s · fetched{" "}
            {timeAgo(data.fetchedAt)}
            {data.primaryBase && (
              <>
                {" "}
                · Base <code>{shortAddr(data.primaryBase)}</code>
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          className="btn-ghost alchemy-refresh-btn"
          disabled={refreshing || !data.configured}
          onClick={() => void forceRefresh()}
        >
          {refreshing ? "Refreshing…" : "Refresh APIs"}
        </button>
      </div>

      {refreshError && <p className="login-error">{refreshError}</p>}
      {data.alchemyAppInactive && (
        <p className="login-error alchemy-inactive-banner">
          Alchemy app inactive —{" "}
          <a
            href="https://dashboard.alchemy.com/apps"
            target="_blank"
            rel="noopener noreferrer"
          >
            create a new app
          </a>
          , copy the API key, and update <code>ALCHEMY_API_KEY</code> in Vercel env.
        </p>
      )}
      {!data.configured && (
        <p className="muted">Set ALCHEMY_API_KEY and watch/trading wallet addresses.</p>
      )}

      <div className="alchemy-api-grid">
        {/* Portfolio API */}
        <section className="alchemy-api-panel">
          <header className="alchemy-api-panel-head">
            <span className="alchemy-api-badge portfolio">Portfolio API</span>
            <span className="alchemy-api-count">{portfolioCount} tokens</span>
          </header>
          {data.portfolio.error && (
            <p className="login-error alchemy-api-error">{data.portfolio.error}</p>
          )}
          {!portfolioCount && !data.portfolio.error && (
            <p className="muted alchemy-api-empty">No fungible balances found</p>
          )}
          <ul className="alchemy-api-list">
            {data.portfolio.tokens.slice(0, 10).map((t, i) => (
              <li key={`${t.network}-${t.tokenAddress ?? "native"}-${i}`} className="alchemy-api-row">
                <div className="alchemy-api-row-top">
                  <span className="alchemy-token-symbol">{t.symbol}</span>
                  <span className="alchemy-token-balance">{t.balance}</span>
                </div>
                <div className="muted alchemy-api-meta">
                  {t.name} · {t.network.replace("-mainnet", "")}
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* NFT API */}
        <section className="alchemy-api-panel">
          <header className="alchemy-api-panel-head">
            <span className="alchemy-api-badge nft">NFT API</span>
            <span className="alchemy-api-count">{nftCount} total</span>
          </header>
          {data.nfts.error && (
            <p className="login-error alchemy-api-error">{data.nfts.error}</p>
          )}
          {!data.nfts.items.length && !data.nfts.error && (
            <p className="muted alchemy-api-empty">
              {data.nfts.totalCount > 0
                ? `${data.nfts.totalCount} NFTs on-chain — refresh or check Portfolio`
                : "No NFTs on Base/Ethereum/Solana for this wallet — token deposits show under Portfolio / Token / Transfers."}
            </p>
          )}
          <div className="alchemy-nft-grid">
            {data.nfts.items.map((n) => (
              <div key={`${n.contract}-${n.tokenId}`} className="alchemy-nft-card">
                {n.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={n.imageUrl} alt={n.name} className="alchemy-nft-img" />
                ) : (
                  <div className="alchemy-nft-placeholder">NFT</div>
                )}
                <div className="alchemy-nft-info">
                  <span className="alchemy-nft-name">{n.name}</span>
                  {n.collectionName && (
                    <span className="muted alchemy-api-meta">{n.collectionName}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Token API */}
        <section className="alchemy-api-panel">
          <header className="alchemy-api-panel-head">
            <span className="alchemy-api-badge token">Token API</span>
            <span className="alchemy-api-count">{tokenCount} ERC-20</span>
          </header>
          {data.tokens.error && (
            <p className="login-error alchemy-api-error">{data.tokens.error}</p>
          )}
          {!tokenCount && !data.tokens.error && (
            <p className="muted alchemy-api-empty">No ERC-20 balances on Base</p>
          )}
          <ul className="alchemy-api-list">
            {data.tokens.items.map((t) => (
              <li key={t.contractAddress} className="alchemy-api-row">
                <div className="alchemy-api-row-top">
                  <span className="alchemy-token-symbol">{t.symbol ?? shortAddr(t.contractAddress)}</span>
                  <span className="alchemy-token-balance">{t.balance}</span>
                </div>
                <div className="muted alchemy-api-meta">
                  {t.name ?? "Token"} · <code>{shortAddr(t.contractAddress)}</code>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Transfers API */}
        <section className="alchemy-api-panel">
          <header className="alchemy-api-panel-head">
            <span className="alchemy-api-badge transfers">Transfers API</span>
            <span className="alchemy-api-count">{transferCount} recent</span>
          </header>
          {data.transfers.error && (
            <p className="login-error alchemy-api-error">{data.transfers.error}</p>
          )}
          {!transferCount && !data.transfers.error && (
            <p className="muted alchemy-api-empty">
              No transfers found on Base or Ethereum for this wallet
            </p>
          )}
          <ul className="alchemy-api-list alchemy-transfer-list">
            {data.transfers.items.map((t) => {
              const txUrl = txExplorerUrl(chainExplorerKey(t.network), t.hash);
              const counterparty =
                t.direction === "in"
                  ? `from ${shortAddr(t.from)}`
                  : t.direction === "out"
                    ? `to ${shortAddr(t.to)}`
                    : `→ ${shortAddr(t.to)}`;
              return (
                <li key={`${t.network}-${t.hash}-${t.category}-${t.tokenId ?? ""}`} className="alchemy-api-row">
                  <div className="alchemy-api-row-top">
                    <span className="alchemy-transfer-asset">
                      {t.asset}
                      {t.direction && (
                        <span className={`alchemy-transfer-dir dir-${t.direction}`}>
                          {t.direction}
                        </span>
                      )}
                    </span>
                    <span className="alchemy-token-balance">{t.value || "—"}</span>
                  </div>
                  <div className="muted alchemy-api-meta">
                    {t.category} · {t.network.replace("-mainnet", "")} · {counterparty}
                    {t.timestamp && ` · ${timeAgo(t.timestamp)}`}
                  </div>
                  {txUrl && (
                    <a
                      href={txUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="web3-tx-link"
                    >
                      {t.hash.slice(0, 14)}…
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
