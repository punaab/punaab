"use client";

import type { Web3Hub } from "@/lib/web3-dashboard";
import { explorerUrl, txExplorerUrl } from "@/lib/web3-dashboard";
import AlchemyApiPanels from "./AlchemyApiPanels";

function shortAddr(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function chainLabel(chain: string): string {
  if (chain.includes("solana")) return "Solana";
  if (chain.includes("base")) return "Base";
  if (chain.includes("ethereum")) return "Ethereum";
  return chain;
}

function chainClass(chain: string): string {
  if (chain.includes("solana")) return "chain-sol";
  if (chain.includes("base")) return "chain-base";
  if (chain.includes("ethereum")) return "chain-eth";
  return "chain-default";
}

interface Props {
  hub: Web3Hub | null | undefined;
  onRefresh?: () => void;
}

export default function Web3CommandCenter({ hub, onRefresh }: Props) {
  if (!hub) return null;

  const balances = hub.snapshot?.balances ?? [];
  const tradeLog = hub.trading?.log ?? [];
  const onchainEvents = hub.onchainEvents ?? [];
  const agentActivity = hub.agentActivity ?? [];
  const tradeCount = tradeLog.length;
  const eventCount = onchainEvents.length;
  const liveTrades = tradeLog.filter((t) => !t.dryRun && t.signature).length;

  return (
    <section className="web3-command panel panel-wide">
      <div className="web3-command-glow" aria-hidden />

      <header className="web3-command-header">
        <div>
          <p className="web3-eyebrow">On-chain operations</p>
          <h2 className="web3-title">Web3 Command</h2>
          <p className="web3-subtitle muted">
            Alchemy Portfolio · NFT · Token · Transfers — cached server-side
          </p>
        </div>
        <div className="web3-status-pills">
          <span
            className={`web3-pill ${hub.infra.alchemyConfigured ? "web3-pill-ok" : "web3-pill-warn"}`}
          >
            Alchemy {hub.infra.alchemyConfigured ? "ON" : "OFF"}
          </span>
          <span
            className={`web3-pill ${hub.infra.webhookAuthConfigured ? "web3-pill-ok" : "web3-pill-warn"}`}
          >
            Webhook auth {hub.infra.webhookAuthConfigured ? "ON" : "OFF"}
          </span>
          <span
            className={`web3-pill ${hub.trading.enabled ? "web3-pill-ok" : ""}`}
          >
            Trading {hub.trading.enabled ? "ON" : "OFF"}
          </span>
          {hub.infra.dryRun && (
            <span className="web3-pill web3-pill-dry">DRY RUN</span>
          )}
        </div>
      </header>

      <div className="web3-stat-grid">
        <div className="web3-stat-card">
          <span className="web3-stat-label">Wallets tracked</span>
          <span className="web3-stat-value">{balances.length}</span>
        </div>
        <div className="web3-stat-card">
          <span className="web3-stat-label">Webhook events</span>
          <span className="web3-stat-value">{eventCount}</span>
        </div>
        <div className="web3-stat-card">
          <span className="web3-stat-label">Trades logged</span>
          <span className="web3-stat-value">{tradeCount}</span>
          <span className="web3-stat-sub">{liveTrades} executed</span>
        </div>
        <div className="web3-stat-card">
          <span className="web3-stat-label">DAS cache</span>
          <span className="web3-stat-value">{hub.infra.holdingsCacheSec}s</span>
          <span className="web3-stat-sub">
            {hub.infra.dasEnabled ? "scans enabled" : "scans off"}
          </span>
        </div>
      </div>

      <div className="web3-grid">
        {/* Wallets */}
        <div className="web3-panel">
          <h3 className="web3-panel-title">Wallet radar</h3>
          {hub.snapshot && (
            <p className="muted web3-panel-hint">
              Snapshot {timeAgo(hub.snapshot.capturedAt)} · refreshes on heartbeat
              (max 1/day)
            </p>
          )}
          {!balances.length && (
            <p className="muted">Set WATCH_BASE_ADDRESS / WATCH_SOLANA_ADDRESS</p>
          )}
          <div className="web3-wallet-grid">
            {balances.map((b) => {
              const href = explorerUrl(b.chain, b.address);
              return (
                <div key={`${b.chain}-${b.address}`} className="web3-wallet-card">
                  <span className={`web3-chain-badge ${chainClass(b.chain)}`}>
                    {chainLabel(b.chain)}
                  </span>
                  <div className="web3-wallet-balance">
                    {b.balance}{" "}
                    <span className="web3-wallet-symbol">{b.symbol}</span>
                  </div>
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="web3-wallet-addr"
                    >
                      {shortAddr(b.address)}
                    </a>
                  ) : (
                    <code className="web3-wallet-addr">{shortAddr(b.address)}</code>
                  )}
                </div>
              );
            })}
          </div>
          {(hub.infra.tradingSolana || hub.infra.tradingBase) && (
            <div className="web3-trading-addrs">
              <span className="web3-panel-subtitle">Agent trading wallets</span>
              {hub.infra.tradingSolana && (
                <div className="web3-addr-row">
                  <span className="chain-sol">SOL</span>
                  <code>{shortAddr(hub.infra.tradingSolana)}</code>
                </div>
              )}
              {hub.infra.tradingBase && (
                <div className="web3-addr-row">
                  <span className="chain-base">BASE</span>
                  <code>{shortAddr(hub.infra.tradingBase)}</code>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Webhook stream */}
        <div className="web3-panel web3-panel-stream">
          <h3 className="web3-panel-title">Alchemy webhook stream</h3>
          <p className="muted web3-panel-hint">
            POST only · signing key verified ·{" "}
            <code className="web3-inline-code">{hub.webhookUrl}</code>
          </p>
          {!onchainEvents.length && (
            <p className="muted web3-empty">Waiting for on-chain events…</p>
          )}
          <ul className="web3-event-list">
            {onchainEvents.map((e) => (
              <li key={e.id} className="web3-event-item">
                <div className="web3-event-pulse" />
                <div className="web3-event-body">
                  <span className="web3-event-type">{e.type}</span>
                  <p>{e.summary}</p>
                  <span className="activity-time">{timeAgo(e.timestamp)}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Trade log */}
        <div className="web3-panel">
          <h3 className="web3-panel-title">Trade log</h3>
          <p className="muted web3-panel-hint">
            Jupiter (Solana) + 0x / Wallet APIs (Base)
          </p>
          {!tradeLog.length && (
            <p className="muted web3-empty">No trades yet</p>
          )}
          <ul className="web3-trade-list">
            {tradeLog.map((t) => {
              const txUrl = txExplorerUrl(t.chain, t.signature ?? "");
              return (
                <li key={t.id} className="web3-trade-item">
                  <div className="web3-trade-top">
                    <span className={`web3-chain-badge ${chainClass(t.chain ?? "solana")}`}>
                      {t.chain ?? "solana"}
                    </span>
                    <span className="web3-trade-action">
                      {t.action}
                      {t.dryRun ? " · dry" : ""}
                    </span>
                    <span className="activity-time">{timeAgo(t.timestamp)}</span>
                  </div>
                  <div className="muted">
                    {t.inputAmount} → {t.outputAmount ?? "?"}
                  </div>
                  {t.signature && txUrl && (
                    <a
                      href={txUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="web3-tx-link"
                    >
                      {t.signature.slice(0, 18)}…
                    </a>
                  )}
                  {t.error && <div className="login-error">{t.error}</div>}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Agent web3 activity */}
        <div className="web3-panel">
          <h3 className="web3-panel-title">Agent web3 actions</h3>
          <p className="muted web3-panel-hint">From heartbeat activity log</p>
          {!agentActivity.length && (
            <p className="muted web3-empty">No web3 actions logged yet</p>
          )}
          <ul className="web3-agent-list">
            {agentActivity.slice(0, 8).map((a) => (
              <li key={a.id} className="web3-agent-item">
                <span className="activity-action">{a.action}</span>
                <p>{a.summary ?? a.content?.slice(0, 120)}</p>
                <span className="activity-time">{timeAgo(a.timestamp)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <AlchemyApiPanels data={hub.alchemy} onRefresh={onRefresh} />

      {hub.prediction && (
        <p className="muted web3-panel-hint web3-prediction-ref">
          Up/Down arb radar at top · {hub.prediction.tradesToday} trades today ·
          cron every 2m or admin <code>Pred tick</code>
        </p>
      )}

      <footer className="web3-footer muted">
        CU-safe: Alchemy APIs cached {hub.infra.holdingsCacheSec}s (Refresh APIs busts cache).
        Use filtered Custom Webhooks — never empty address/topic filters.
      </footer>
    </section>
  );
}
