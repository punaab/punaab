"use client";

import type { Web3Hub } from "@/lib/web3-dashboard";
import type { AlchemyApiSnapshot, PortfolioTokenRow } from "@/lib/alchemy-apis";

type Prediction = NonNullable<Web3Hub["prediction"]>;

interface Props {
  prediction: Prediction | null | undefined;
  alchemy?: AlchemyApiSnapshot | null;
  hubBalances?: Array<{
    chain: string;
    address: string;
    balance: string;
    symbol: string;
  }>;
  alchemyEvm?: string;
  alchemySolana?: string;
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

function parseTokenBalance(raw: string): number {
  const n = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function getFallbackAlchemyEvm(): string {
  return "0x310648bd5ad77b4a4dd8725d53902d52e475ec73";
}

function getFallbackAlchemySol(): string {
  return "6VoBMcEgfdWSCBYBJ46QkzyHiZ2S4WU6YWRdej5zUbhZ";
}

function alchemyPortfolioSummary(
  alchemy: AlchemyApiSnapshot | null | undefined,
  allowedEvm?: string,
  allowedSol?: string,
) {
  const evm = (allowedEvm ?? alchemy?.primaryBase)?.toLowerCase();
  const solAddr = allowedSol ?? alchemy?.primarySolana;
  const tokens: PortfolioTokenRow[] = (alchemy?.portfolio?.tokens ?? []).filter(
    (t) => {
      const owner = (t.address || "").trim();
      if (!owner) return true;
      if (evm && owner.toLowerCase() === evm) return true;
      if (solAddr && owner === solAddr) return true;
      return false;
    },
  );

  const ETH_USD = 2000;
  const SOL_USD = 150;

  let usdc = 0;
  let eth = 0;
  let sol = 0;
  let worthFromPrices = 0;

  const byNetwork: Record<
    string,
    { usdc: number; eth: number; sol: number; otherUsd: number }
  > = {};

  const ensureNet = (net: string) => {
    const key = net || "unknown";
    if (!byNetwork[key]) {
      byNetwork[key] = { usdc: 0, eth: 0, sol: 0, otherUsd: 0 };
    }
    return byNetwork[key]!;
  };

  for (const t of tokens) {
    const bal = parseTokenBalance(t.balance);
    const sym = (t.symbol || "").toUpperCase();
    const net = (t.network || "").toLowerCase();
    const bucket = ensureNet(net);
    const hasPx = typeof t.valueUsd === "number" && t.valueUsd > 0;

    if (sym.includes("USDC") || sym === "USDT" || sym === "DAI" || sym === "USDBC") {
      usdc += bal;
      bucket.usdc += bal;
      worthFromPrices += hasPx ? t.valueUsd! : bal;
      continue;
    }

    if (
      sym === "ETH" ||
      sym === "WETH" ||
      (t.isNative &&
        !net.includes("solana") &&
        (net.includes("eth") || net.includes("arb") || net.includes("base") || !net))
    ) {
      eth += bal;
      bucket.eth += bal;
      worthFromPrices += hasPx ? t.valueUsd! : bal * ETH_USD;
      continue;
    }

    if (sym === "SOL" || (t.isNative && net.includes("solana"))) {
      sol += bal;
      bucket.sol += bal;
      worthFromPrices += hasPx ? t.valueUsd! : bal * SOL_USD;
      continue;
    }

    if (hasPx) {
      worthFromPrices += t.valueUsd!;
      bucket.otherUsd += t.valueUsd!;
    }
  }

  const approxWorth = usdc + eth * ETH_USD + sol * SOL_USD;
  const totalWorthFinal = Math.max(worthFromPrices, approxWorth, usdc);

  const chainRows = Object.entries(byNetwork)
    .map(([network, b]) => {
      const worth =
        b.usdc + b.eth * ETH_USD + b.sol * SOL_USD + b.otherUsd;
      return { network, ...b, worth };
    })
    .filter((c) => c.worth > 0.01 || c.usdc > 0 || c.eth > 0 || c.sol > 0)
    .sort((a, b) => b.worth - a.worth);

  return {
    usdc,
    eth,
    sol,
    arbUsdc: byNetwork["arb-mainnet"]?.usdc ?? 0,
    baseUsdc: byNetwork["base-mainnet"]?.usdc ?? 0,
    ethUsdc: byNetwork["eth-mainnet"]?.usdc ?? 0,
    solUsdc: Object.entries(byNetwork)
      .filter(([n]) => n.includes("solana"))
      .reduce((s, [, b]) => s + b.usdc, 0),
    totalWorth: totalWorthFinal,
    chainRows,
    tokenCount: tokens.length,
    transferCount: alchemy?.transfers?.items?.length ?? 0,
    tokens,
    evm: alchemy?.primaryBase,
    solana: alchemy?.primarySolana,
  };
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

export default function ArbitrageGraph({
  prediction,
  alchemy,
  alchemyEvm,
  alchemySolana,
}: Props) {
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

  const displayEvm =
    alchemyEvm ?? alchemy?.primaryBase ?? getFallbackAlchemyEvm();
  const displaySol =
    alchemySolana ?? alchemy?.primarySolana ?? getFallbackAlchemySol();
  const alch = alchemyPortfolioSummary(alchemy, displayEvm, displaySol);

  const usdc = alch.usdc;
  const arbUsdc = alch.arbUsdc;
  const sol = alch.sol;
  const ethFromAlchemy = alch.eth;
  const alchemyWorthApprox = alch.totalWorth;
  const totalEquity = alchemyWorthApprox;
  const chainRows = alch.chainRows;
  const topTokens = alch.tokens
    .filter((t) => parseTokenBalance(t.balance) > 0)
    .slice(0, 12)
    .map((t) => ({
      symbol: t.symbol,
      amount: parseTokenBalance(t.balance),
      valueUsd:
        t.valueUsd ??
        ((t.symbol || "").toUpperCase().includes("USDC")
          ? parseTokenBalance(t.balance)
          : 0),
      mint: `${t.network}:${t.tokenAddress ?? t.symbol}`,
      network: t.network,
    }));
  const displayTokens = topTokens;
  const walletCapturedAt = alchemy?.fetchedAt;

  const forecastUsdc = wallet?.usdc ?? prediction?.latestWallet?.usdc ?? 0;
  const forecastSol = wallet?.sol ?? prediction?.latestWallet?.sol ?? 0;
  const forecastWorth =
    wallet?.totalWorthUsd ??
    prediction?.latestWallet?.totalWorthUsd ??
    forecastUsdc;
  const forecastPosValue =
    wallet?.positionValueUsd ?? prediction?.latestWallet?.positionValueUsd ?? 0;
  const forecastAddress =
    wallet?.address ??
    prediction?.walletAddress ??
    prediction?.latestWallet?.address ??
    null;

  return (
    <section className="arb-graph panel panel-wide">
      <header className="arb-graph-header">
        <div>
          <p className="arb-eyebrow">Forecast trading capital · Alchemy residual</p>
          <h2 className="arb-title">Wallet Command</h2>
        </div>
        <div className="arb-stat-chips">
          <span className={`arb-chip ${prediction?.enabled && !prediction?.dryRun ? "arb-chip-hot" : ""}`}>
            {prediction?.dryRun ? "DRY RUN" : prediction?.enabled ? "LIVE" : "OFF"}
          </span>
          <span className={`arb-chip ${hasArb ? "arb-chip-hot" : ""}`}>
            Forecast edge{" "}
            {bestEdge > 0 ? `${(bestEdge / 100).toFixed(1)}%` : "—"}
          </span>
          <span className="arb-chip">
            {prediction?.tradesToday ?? 0} trades today
          </span>
          <span className="arb-chip muted-chip">
            {timeAgo(
              prediction?.lastTick?.timestamp ??
                latest?.timestamp ??
                walletCapturedAt,
            )}{" "}
            ago
          </span>
        </div>
      </header>

      {/* Forecast hot wallet = working capital (signing) */}
      <div className="arb-wallet-grid">
        <div className="arb-wallet-card arb-wallet-primary">
          <span className="arb-wallet-label">
            Forecast hot wallet ·{" "}
            {prediction?.dryRun
              ? "DRY RUN"
              : prediction?.enabled
                ? "LIVE"
                : "OFF"}
          </span>
          <span className="arb-wallet-value">{formatUsd(forecastWorth)}</span>
          <span className="arb-wallet-sub">
            {formatUsd(forecastUsdc)} USDC · {forecastSol.toFixed(4)} SOL
            {forecastPosValue > 0
              ? ` · pos ${formatUsd(forecastPosValue)}`
              : ""}
            {forecastAddress ? ` · ${shortAddr(forecastAddress)}` : ""}
          </span>
        </div>
        <div className="arb-wallet-card">
          <span className="arb-wallet-label">live USDC</span>
          <span className="arb-wallet-value">{formatUsd(forecastUsdc)}</span>
          <span className="arb-wallet-sub">
            {forecastAddress ? (
              <a
                href={`https://solscan.io/account/${forecastAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="arb-wallet-link"
              >
                {shortAddr(forecastAddress)}
              </a>
            ) : (
              "signing wallet"
            )}
          </span>
        </div>
        <div className="arb-wallet-card">
          <span className="arb-wallet-label">Forecast today</span>
          <span className="arb-wallet-value">{prediction?.tradesToday ?? 0}</span>
          <span className="arb-wallet-sub">
            {formatUsd(prediction?.usdcDeployedToday ?? 0)} deployed
          </span>
        </div>
        <div className="arb-wallet-card">
          <span className="arb-wallet-label">Alchemy residual</span>
          <span className="arb-wallet-value">{formatUsd(totalEquity)}</span>
          <span className="arb-wallet-sub">
            Arb {formatUsd(arbUsdc || alch.arbUsdc)} · not signing Forecast
          </span>
        </div>
        <div className="arb-wallet-card">
          <span className="arb-wallet-label">Arb USDC</span>
          <span className="arb-wallet-value">{formatUsd(arbUsdc || alch.arbUsdc)}</span>
          <span className="arb-wallet-sub">
            {displayEvm ? shortAddr(displayEvm) : "Alchemy EVM"}
          </span>
        </div>
        <div className="arb-wallet-card">
          <span className="arb-wallet-label">Alchemy Sol session</span>
          <span className="arb-wallet-value">
            {formatUsd((alch.solUsdc || 0) + sol * 150)}
          </span>
          <span className="arb-wallet-sub">
            {formatUsd(alch.solUsdc || 0)} USDC · {sol.toFixed(4)} SOL
            {displaySol ? ` · ${shortAddr(displaySol)}` : ""}
          </span>
        </div>
        {(displayEvm || displaySol) && (
          <div className="arb-wallet-card arb-wallet-addr">
            <span className="arb-wallet-label">Alchemy wallets</span>
            {displayEvm && (
              <a
                href={`https://arbiscan.io/address/${displayEvm}`}
                target="_blank"
                rel="noopener noreferrer"
                className="arb-wallet-link"
              >
                EVM {shortAddr(displayEvm)}
              </a>
            )}
            {displaySol && (
              <a
                href={`https://solscan.io/account/${displaySol}`}
                target="_blank"
                rel="noopener noreferrer"
                className="arb-wallet-link"
              >
                SOL {shortAddr(displaySol)}
              </a>
            )}
            <span className="arb-wallet-sub">
              {walletCapturedAt
                ? `Alchemy · ${timeAgo(walletCapturedAt)} ago`
                : "Agent Wallet session"}
            </span>
          </div>
        )}
      </div>

      {chainRows.length > 0 && (
        <div className="arb-tokens-row">
          <span className="arb-tokens-label">By chain (Alchemy only)</span>
          <ul className="arb-tokens-list">
            {chainRows.map((c) => (
              <li key={c.network} className="arb-token-chip">
                <span className="arb-token-sym">
                  {c.network.replace("-mainnet", "")}
                </span>
                <span className="arb-token-amt">{formatUsd(c.worth)}</span>
                <span className="arb-token-val">
                  {c.usdc > 0 ? `${formatUsd(c.usdc)} USDC` : ""}
                  {c.eth > 0 ? ` · ${c.eth.toFixed(4)} ETH` : ""}
                  {c.sol > 0 ? ` · ${c.sol.toFixed(4)} SOL` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {displayTokens.length > 0 && (
        <div className="arb-tokens-row">
          <span className="arb-tokens-label">Alchemy balances</span>
          <ul className="arb-tokens-list">
            {displayTokens.map((t) => (
              <li key={t.mint} className="arb-token-chip">
                <span className="arb-token-sym">
                  {t.symbol}
                  {"network" in t && t.network
                    ? ` · ${String(t.network).replace("-mainnet", "")}`
                    : ""}
                </span>
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

      {!displayEvm && !displaySol && forecastWorth <= 0 && (
        <p className="muted arb-empty">
          Waiting on Forecast wallet snapshot — click Pred tick, or set Alchemy
          wallet envs for residual display.
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
              <span>Forecast worth</span>
              <span className="arb-edge-hot">{formatUsd(forecastWorth)}</span>
            </div>
            <Sparkline
              values={
                usdcSeries.length
                  ? usdcSeries
                  : forecastWorth > 0
                    ? [forecastWorth * 0.98, forecastWorth]
                    : []
              }
              color="var(--cyan)"
              fillId="arbSparkWallet"
              emptyLabel="Awaiting Pred tick"
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
              {formatUsd(forecastPosValue)} mark
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
