"use client";

import type { Web3Hub } from "@/lib/web3-dashboard";

type Prediction = NonNullable<Web3Hub["prediction"]>;

interface Props {
  prediction: Prediction | null | undefined;
  hubBalances?: Array<{
    chain: string;
    address: string;
    balance: string;
    symbol: string;
  }>;
}

function shortTitle(title: string, max = 28): string {
  return title.length <= max ? title : `${title.slice(0, max - 1)}…`;
}

function shortAddr(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function formatCents(usd: number): string {
  return `${Math.round(usd * 100)}¢`;
}

function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `$${n.toFixed(n >= 100 ? 0 : 2)}`;
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h`;
}

function sparkPath(
  values: number[],
  width: number,
  height: number,
  pad = 4,
): string {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = (width - pad * 2) / (values.length - 1);
  return values
    .map((v, i) => {
      const x = pad + i * step;
      const y = height - pad - ((v - min) / range) * (height - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function Sparkline({
  values,
  color,
  fillId,
  emptyLabel,
}: {
  values: number[];
  color: string;
  fillId: string;
  emptyLabel: string;
}) {
  const w = 280;
  const h = 48;
  const path = sparkPath(values, w, h);
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="arb-sparkline"
      role="img"
      aria-hidden
    >
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {values.length >= 2 && path ? (
        <>
          <path
            d={`${path} L${w - 4},${h - 4} L4,${h - 4} Z`}
            fill={`url(#${fillId})`}
          />
          <path
            d={path}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </>
      ) : (
        <text
          x={w / 2}
          y={h / 2 + 4}
          textAnchor="middle"
          className="arb-spark-empty"
        >
          {emptyLabel}
        </text>
      )}
    </svg>
  );
}

export default function ArbitrageGraph({ prediction, hubBalances }: Props) {
  const history = prediction?.arbHistory ?? [];
  const walletHistory = prediction?.walletHistory ?? [];
  const latest = prediction?.latestArb;
  const wallet = prediction?.wallet;
  const markets = latest?.markets ?? [];
  const edgeSeries = history.map((h) => h.bestEdgeBps);
  const usdcSeries = walletHistory.map(
    (h) =>
      h.totalWorthUsd ??
      (h.solValueUsd ?? 0) + h.usdc + h.positionValueUsd,
  );
  const sorted = [...markets]
    .filter((m) => {
      if (m.marketId.startsWith("POLY-")) return false;
      if (m.yes > 0 && m.yes < 0.04) return false;
      if (m.no > 0 && m.no < 0.04) return false;
      if (m.combined > 0 && m.combined < 0.82) return false;
      if (m.edgeBps >= 5000) return false;
      return true;
    })
    .sort((a, b) => b.edgeBps - a.edgeBps);
  const bestEdge = sorted[0]?.edgeBps ?? 0;
  const hasArb = bestEdge >= 200;
  const trades = prediction?.log ?? [];
  const openLegs = prediction?.openLegs ?? [];
  const positions = wallet?.positions ?? [];

  const address =
    wallet?.address ??
    prediction?.walletAddress ??
    prediction?.latestWallet?.address ??
    null;

  const hubSol = hubBalances?.find((b) => {
    if (!b.chain.includes("solana") || b.symbol !== "SOL") return false;
    if (!address) return true;
    return b.address === address;
  });

  const usdc = wallet?.usdc ?? prediction?.latestWallet?.usdc ?? 0;
  const solRaw = wallet?.sol ?? prediction?.latestWallet?.sol ?? 0;
  const sol =
    solRaw > 0
      ? solRaw
      : hubSol?.balance != null && Number.isFinite(Number(hubSol.balance))
        ? Number(hubSol.balance)
        : 0;
  const posValue =
    wallet?.positionValueUsd ?? prediction?.latestWallet?.positionValueUsd ?? 0;
  const solValue =
    wallet?.solValueUsd ??
    prediction?.latestWallet?.solValueUsd ??
    0;
  const tokensValue =
    wallet?.tokensValueUsd ?? prediction?.latestWallet?.tokensValueUsd ?? usdc;
  const totalEquity =
    wallet?.totalWorthUsd ??
    prediction?.latestWallet?.totalWorthUsd ??
    solValue + tokensValue + posValue;
  const tradeableCapital =
    wallet?.tradeableCapitalUsd ??
    prediction?.latestWallet?.tradeableCapitalUsd ??
    Math.max(0, totalEquity - posValue);
  const topTokens = wallet?.topTokens ?? [];
  const solPrice = wallet?.solPriceUsd ?? 0;
  const walletCapturedAt =
    wallet && "capturedAt" in wallet
      ? (wallet as { capturedAt?: string }).capturedAt
      : undefined;

  return (
    <section className="arb-graph panel panel-wide">
      <header className="arb-graph-header">
        <div>
          <p className="arb-eyebrow">Jupiter Forecast · Solana wallet</p>
          <h2 className="arb-title">Arbitrage Radar</h2>
        </div>
        <div className="arb-stat-chips">
          <span className={`arb-chip ${hasArb ? "arb-chip-hot" : ""}`}>
            Edge {bestEdge > 0 ? `${(bestEdge / 100).toFixed(1)}%` : "—"}
          </span>
          <span className="arb-chip">
            {prediction?.dryRun ? "DRY RUN" : "LIVE"}
          </span>
          <span className="arb-chip">
            {prediction?.limits?.scalpEnabled !== false ? "SCALP+ARB" : "ARB"}
          </span>
          <span className="arb-chip">
            API{" "}
            {prediction?.apiAccess.ok
              ? "OK"
              : prediction?.apiAccess &&
                  "geoBlocked" in prediction.apiAccess &&
                  prediction.apiAccess.geoBlocked
                ? "GEO"
                : "ERR"}
          </span>
          <span className="arb-chip muted-chip">
            {timeAgo(
              walletCapturedAt ??
                latest?.timestamp ??
                prediction?.lastTick?.timestamp,
            )}{" "}
            ago
          </span>
        </div>
      </header>

      {/* Live wallet balances */}
      <div className="arb-wallet-grid">
        <div className="arb-wallet-card arb-wallet-primary">
          <span className="arb-wallet-label">Wallet worth</span>
          <span className="arb-wallet-value">{formatUsd(totalEquity)}</span>
          <span className="arb-wallet-sub">
            {formatUsd(solValue || sol * solPrice)} SOL
            {" · "}
            {formatUsd(usdc)} USDC
            {posValue > 0 ? ` · ${formatUsd(posValue)} pos` : ""}
          </span>
        </div>
        <div className="arb-wallet-card">
          <span className="arb-wallet-label">Trading capital</span>
          <span className="arb-wallet-value">
            {formatUsd(tradeableCapital)}
          </span>
          <span className="arb-wallet-sub">
            {formatUsd(usdc)} USDC · auto-swaps SOL/SPL
          </span>
        </div>
        <div className="arb-wallet-card">
          <span className="arb-wallet-label">SOL</span>
          <span className="arb-wallet-value">{sol.toFixed(4)}</span>
          <span className="arb-wallet-sub">
            {solPrice > 0
              ? `${formatUsd(solValue || sol * solPrice)} @ $${solPrice.toFixed(0)}`
              : "gas reserve"}
          </span>
        </div>
        <div className="arb-wallet-card">
          <span className="arb-wallet-label">Today</span>
          <span className="arb-wallet-value">{prediction?.tradesToday ?? 0}</span>
          <span className="arb-wallet-sub">
            {formatUsd(prediction?.usdcDeployedToday ?? 0)} deployed
          </span>
        </div>
        <div className="arb-wallet-card">
          <span className="arb-wallet-label">Open</span>
          <span className="arb-wallet-value">
            {wallet?.openPositions ??
              (positions.length > 0 ? positions.length : openLegs.length)}
          </span>
          <span className="arb-wallet-sub">
            {openLegs.length} ledger legs
          </span>
        </div>
        {address && (
          <div className="arb-wallet-card arb-wallet-addr">
            <span className="arb-wallet-label">Wallet</span>
            <a
              href={`https://solscan.io/account/${address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="arb-wallet-link"
            >
              {shortAddr(address)}
            </a>
            <span className="arb-wallet-sub">
              {walletCapturedAt
                ? `live · ${timeAgo(walletCapturedAt)} ago`
                : "Solana · Jupiter"}
            </span>
          </div>
        )}
      </div>

      {topTokens.length > 0 && (
        <div className="arb-tokens-row">
          <span className="arb-tokens-label">Top balances</span>
          <ul className="arb-tokens-list">
            {topTokens.map((t) => (
              <li key={t.mint} className="arb-token-chip">
                <span className="arb-token-sym">{t.symbol}</span>
                <span className="arb-token-amt">
                  {t.amount >= 100
                    ? t.amount.toFixed(0)
                    : t.amount >= 1
                      ? t.amount.toFixed(2)
                      : t.amount.toFixed(4)}
                </span>
                <span className="arb-token-val">
                  {t.valueUsd > 0 ? formatUsd(t.valueUsd) : "—"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!address && (
        <p className="muted arb-empty">
          Set <code>TRADING_SOLANA_ADDRESS</code> to show live wallet balances.
        </p>
      )}
      {address && usdc === 0 && sol === 0 && (
        <p className="muted arb-empty">
          Wallet {shortAddr(address)} shows 0 SOL / 0 USDC — fund it or check
          Alchemy RPC / Vercel env matches this address.
        </p>
      )}

      <div className="arb-graph-body">
        <div className="arb-sparks-col">
          <div className="arb-spark-panel">
            <div className="arb-spark-label">
              <span>Best edge</span>
              <span className={hasArb ? "arb-edge-hot" : ""}>
                {edgeSeries.length ? `${(bestEdge / 100).toFixed(1)}%` : "—"}
              </span>
            </div>
            <Sparkline
              values={edgeSeries}
              color="var(--success)"
              fillId="arbSparkEdge"
              emptyLabel="Awaiting cron tick"
            />
          </div>
          <div className="arb-spark-panel">
            <div className="arb-spark-label">
              <span>Wallet worth</span>
              <span className="arb-edge-hot">{formatUsd(totalEquity)}</span>
            </div>
            <Sparkline
              values={
                usdcSeries.length
                  ? usdcSeries
                  : totalEquity > 0
                    ? [totalEquity]
                    : []
              }
              color="var(--cyan)"
              fillId="arbSparkWallet"
              emptyLabel="Awaiting balance history"
            />
          </div>
        </div>

        <div className="arb-markets-panel">
          <div className="arb-markets-head">
            <span>Market</span>
            <span>UP</span>
            <span>DOWN</span>
            <span>Combined</span>
            <span>Edge</span>
          </div>
          {!sorted.length && (
            <p className="muted arb-empty">
              No live Forecast markets yet. Cron runs every 2m, or click{" "}
              <strong>Pred tick</strong> in the top bar.
            </p>
          )}
          {sorted.slice(0, 6).map((m) => {
            const gap = Math.max(0, 1 - m.combined);
            const yesPct = Math.min(100, m.yes * 100);
            const noPct = Math.min(100 - yesPct, m.no * 100);
            const gapPct = Math.max(0, 100 - yesPct - noPct);
            return (
              <div key={m.marketId} className="arb-market-row">
                <div className="arb-market-meta">
                  <span className="arb-market-title" title={m.title}>
                    {shortTitle(m.title)}
                  </span>
                  <span className="arb-market-id">
                    {m.marketId.startsWith("BISON-") || m.isForecast
                      ? "Jupiter Forecast"
                      : m.marketId.startsWith("POLY-")
                        ? "Polymarket"
                        : "Prediction"}{" "}
                    ·{" "}
                    {m.secondsToClose != null && m.secondsToClose < 900
                      ? `${Math.floor(m.secondsToClose / 60)}m left`
                      : m.marketId
                          .replace(/^BISON-/, "")
                          .replace(/^POLY-/, "P-")
                          .slice(0, 16)}
                  </span>
                </div>
                <span className="arb-price yes">{formatCents(m.yes)}</span>
                <span className="arb-price no">{formatCents(m.no)}</span>
                <span className="arb-combined">{formatCents(m.combined)}</span>
                <span
                  className={`arb-edge ${m.edgeBps >= 200 ? "arb-edge-hot" : ""}`}
                >
                  {m.edgeBps > 0 ? `+${(m.edgeBps / 100).toFixed(1)}%` : "—"}
                </span>
                <div
                  className="arb-bar-track"
                  title={`$1.00 − ${formatCents(m.combined)} = ${formatCents(gap)} edge`}
                >
                  <div className="arb-bar-yes" style={{ width: `${yesPct}%` }} />
                  <div className="arb-bar-no" style={{ width: `${noPct}%` }} />
                  <div className="arb-bar-gap" style={{ width: `${gapPct}%` }} />
                  <div className="arb-parity-line" />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Latest trades + positions */}
      <div className="arb-bottom-grid">
        <div className="arb-trades-panel">
          <div className="arb-panel-head">
            <span>Latest trades</span>
            <span className="muted">{trades.length} logged</span>
          </div>
          {!trades.length && (
            <p className="muted arb-empty">No prediction trades yet.</p>
          )}
          <ul className="arb-trade-list">
            {trades.slice(0, 8).map((t) => (
              <li key={t.id} className="arb-trade-item">
                <div className="arb-trade-top">
                  <span
                    className={`arb-side-pill ${t.isBuy ? "buy" : "sell"}`}
                  >
                    {t.isBuy ? "BUY" : "SELL"} {t.side.toUpperCase()}
                  </span>
                  <span className="arb-trade-amt">
                    ${t.depositUsdc}
                    {t.dryRun ? " dry" : ""}
                  </span>
                  <span className="activity-time">{timeAgo(t.timestamp)}</span>
                </div>
                <p className="arb-trade-reason">
                  {t.strategy.replace(/_/g, " ")} · {shortTitle(t.reason, 56)}
                </p>
                {t.signature && (
                  <a
                    href={`https://solscan.io/tx/${t.signature}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="arb-tx-link"
                  >
                    {t.signature.slice(0, 16)}…
                  </a>
                )}
                {t.error && <div className="login-error">{t.error}</div>}
              </li>
            ))}
          </ul>
        </div>

        <div className="arb-positions-panel">
          <div className="arb-panel-head">
            <span>Positions</span>
            <span className="muted">
              {formatUsd(posValue)} mark
            </span>
          </div>
          {!positions.length && !openLegs.length && (
            <p className="muted arb-empty">No open positions.</p>
          )}
          {positions.length > 0 && (
            <ul className="arb-trade-list">
              {positions.slice(0, 6).map((p) => (
                <li key={p.positionPubkey} className="arb-trade-item">
                  <div className="arb-trade-top">
                    <span className={`arb-side-pill ${p.isYes ? "buy" : "sell"}`}>
                      {p.isYes ? "YES" : "NO"}
                    </span>
                    <span className="arb-trade-amt">{formatUsd(p.valueUsd)}</span>
                    {p.claimable && (
                      <span className="arb-chip arb-chip-hot">claim</span>
                    )}
                  </div>
                  <p className="arb-trade-reason">
                    {shortTitle(p.marketId, 36)}
                    {p.avgPriceUsd != null
                      ? ` · avg ${formatCents(p.avgPriceUsd)}`
                      : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {!positions.length && openLegs.length > 0 && (
            <ul className="arb-trade-list">
              {openLegs.slice(0, 6).map((leg) => (
                <li key={leg.marketId} className="arb-trade-item">
                  <div className="arb-trade-top">
                    <span className="arb-side-pill buy">LEG</span>
                    <span className="arb-trade-amt">
                      {formatUsd(leg.yesCostUsd + leg.noCostUsd)}
                    </span>
                  </div>
                  <p className="arb-trade-reason">
                    {shortTitle(leg.marketId, 28)} · Y {formatUsd(leg.yesCostUsd)} / N{" "}
                    {formatUsd(leg.noCostUsd)}
                    {leg.stagedSide
                      ? ` · staged ${leg.stagedSide}`
                      : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {prediction?.lastTick?.signals?.length ? (
        <footer className="arb-signals">
          <span className="arb-signals-label">Latest signals</span>
          {prediction.lastTick.signals.slice(0, 4).map((s, i) => (
            <span
              key={`${s.marketId}-${s.side}-${i}`}
              className="arb-signal-pill"
            >
              {s.strategy.replace(/_/g, " ")} · {s.side.toUpperCase()} $
              {s.depositUsdc}
            </span>
          ))}
        </footer>
      ) : null}
    </section>
  );
}
