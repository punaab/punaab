/**
 * Copy-trade Solana wallets (Axiom Vision–style):
 * poll holdings diffs on curated high-winrate wallets, mirror buys/sells via Jupiter.
 *
 * Axiom has no public leaderboard API — paste top winrate wallets from
 * https://axiom.trade/vision into COPY_TRADE_WALLETS.
 */
import {
  COPY_TRADE_LIMITS,
  getCopyTradeWallets,
  getTradingSolanaAddress,
  isCopyTradeDryRun,
  isCopyTradeEnabled,
  isTradingEnabled,
} from "../config";
import { createRedisClient } from "../redis";
import { fetchSolanaWalletHoldings } from "../solana-alchemy";
import {
  executeSwap,
  MINT_SOL,
  MINT_USDC,
  canExecuteTrade,
} from "../trading";

const SNAPSHOT_PREFIX = "copytrade:snap:";
const SEEN_SIGNAL_KEY = "copytrade:seen";
const TRADES_TODAY_KEY = "copytrade:trades_today";

const STABLE_OR_SOL = new Set([
  MINT_SOL,
  MINT_USDC,
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT
  "USD1ttGY1N17NEE4XQr5AhztzyAgwxjJqjX322VwEKe", // USD1
]);

export interface CopyTradeSignal {
  wallet: string;
  side: "buy" | "sell";
  mint: string;
  symbol: string;
  deltaUi: number;
  at: string;
}

export interface CopyTradeTickSummary {
  ok: boolean;
  skipped?: string;
  walletsScanned: number;
  signals: CopyTradeSignal[];
  executed: Array<{ signal: CopyTradeSignal; ok: boolean; signature?: string; error?: string; dryRun?: boolean }>;
  errors: string[];
}

function getRedis() {
  return createRedisClient();
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

type HoldingSnap = Record<string, { ui: number; symbol: string }>;

async function loadSnapshot(wallet: string): Promise<HoldingSnap | null> {
  try {
    const raw = await getRedis().get(`${SNAPSHOT_PREFIX}${wallet}`);
    if (!raw) return null;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed as HoldingSnap;
  } catch {
    return null;
  }
}

async function saveSnapshot(wallet: string, snap: HoldingSnap): Promise<void> {
  await getRedis().set(`${SNAPSHOT_PREFIX}${wallet}`, JSON.stringify(snap), {
    ex: 7 * 86400,
  });
}

async function tradesToday(): Promise<number> {
  try {
    const raw = await getRedis().get(TRADES_TODAY_KEY);
    if (!raw) return 0;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (parsed?.day !== utcDay()) return 0;
    return Number(parsed.count ?? 0);
  } catch {
    return 0;
  }
}

async function bumpTradesToday(): Promise<void> {
  const n = (await tradesToday()) + 1;
  await getRedis().set(
    TRADES_TODAY_KEY,
    JSON.stringify({ day: utcDay(), count: n }),
    { ex: 2 * 86400 },
  );
}

async function seenSignal(id: string): Promise<boolean> {
  try {
    const items = await getRedis().lrange(SEEN_SIGNAL_KEY, 0, 199);
    return (items ?? []).some((x) => String(x) === id);
  } catch {
    return false;
  }
}

async function markSeen(id: string): Promise<void> {
  const r = getRedis();
  await r.lpush(SEEN_SIGNAL_KEY, id);
  await r.ltrim(SEEN_SIGNAL_KEY, 0, 299);
}

async function holdingsToSnap(wallet: string): Promise<HoldingSnap> {
  const h = await fetchSolanaWalletHoldings(wallet);
  const snap: HoldingSnap = {};
  for (const t of h.fungibleTokens) {
    if (t.uiAmount <= 0) continue;
    if (STABLE_OR_SOL.has(t.mint)) continue;
    snap[t.mint] = { ui: t.uiAmount, symbol: t.symbol || t.mint.slice(0, 6) };
  }
  return snap;
}

function diffSignals(wallet: string, prev: HoldingSnap, next: HoldingSnap): CopyTradeSignal[] {
  const signals: CopyTradeSignal[] = [];
  const now = new Date().toISOString();
  const mints = new Set([...Object.keys(prev), ...Object.keys(next)]);

  for (const mint of mints) {
    const before = prev[mint]?.ui ?? 0;
    const after = next[mint]?.ui ?? 0;
    const symbol = next[mint]?.symbol ?? prev[mint]?.symbol ?? mint.slice(0, 6);
    const delta = after - before;
    if (Math.abs(delta) < 1e-9) continue;

    // Ignore dust-sized relative moves
    const base = Math.max(before, after, 1e-9);
    if (Math.abs(delta) / base < 0.05 && Math.abs(delta) < 1) continue;

    signals.push({
      wallet,
      side: delta > 0 ? "buy" : "sell",
      mint,
      symbol,
      deltaUi: delta,
      at: now,
    });
  }
  return signals;
}

export async function runCopyTradeTick(): Promise<CopyTradeTickSummary> {
  const summary: CopyTradeTickSummary = {
    ok: true,
    walletsScanned: 0,
    signals: [],
    executed: [],
    errors: [],
  };

  if (!isCopyTradeEnabled()) {
    summary.skipped = "copy_trade_disabled";
    return summary;
  }
  if (!isTradingEnabled() && !isCopyTradeDryRun()) {
    summary.skipped = "trading_disabled";
    return summary;
  }

  const wallets = getCopyTradeWallets();
  if (wallets.length === 0) {
    summary.skipped = "no_wallets — set COPY_TRADE_WALLETS from Axiom Vision";
    return summary;
  }

  const today = await tradesToday();
  if (today >= COPY_TRADE_LIMITS.maxPerDay && !isCopyTradeDryRun()) {
    summary.skipped = "daily_limit";
    return summary;
  }

  for (const wallet of wallets) {
    summary.walletsScanned += 1;
    try {
      const next = await holdingsToSnap(wallet);
      const prev = await loadSnapshot(wallet);
      await saveSnapshot(wallet, next);

      if (!prev) continue; // first snapshot — establish baseline only

      const signals = diffSignals(wallet, prev, next);
      for (const signal of signals) {
        const id = `${wallet}:${signal.side}:${signal.mint}:${signal.at.slice(0, 13)}`;
        if (await seenSignal(id)) continue;
        await markSeen(id);
        summary.signals.push(signal);

        if (summary.executed.length + today >= COPY_TRADE_LIMITS.maxPerDay) break;

        const dryRun = isCopyTradeDryRun();
        if (!dryRun) {
          const gate = await canExecuteTrade();
          if (!gate.ok) {
            summary.executed.push({ signal, ok: false, error: gate.reason });
            continue;
          }
        }

        if (signal.side === "buy") {
          const amountSol = COPY_TRADE_LIMITS.maxSolPerTrade;
          if (dryRun) {
            summary.executed.push({ signal, ok: true, dryRun: true });
            continue;
          }
          const result = await executeSwap({
            inputMint: MINT_SOL,
            outputMint: signal.mint,
            amountSol,
            reason: `copy_buy ${signal.symbol} from ${wallet.slice(0, 8)}…`,
          });
          if (result.ok && !result.dryRun) await bumpTradesToday();
          summary.executed.push({
            signal,
            ok: result.ok,
            signature: result.signature,
            error: result.error,
            dryRun: result.dryRun,
          });
        } else {
          if (dryRun) {
            summary.executed.push({ signal, ok: true, dryRun: true });
            continue;
          }
          // Sell a chunk of our own balance of this mint (if any)
          const ourWallet = getTradingSolanaAddress();
          if (!ourWallet) {
            summary.executed.push({ signal, ok: false, error: "no_wallet" });
            continue;
          }
          const ours = await fetchSolanaWalletHoldings(ourWallet).catch(() => null);
          const held = ours?.fungibleTokens.find((t) => t.mint === signal.mint);
          if (!held || held.uiAmount <= 0) {
            summary.executed.push({
              signal,
              ok: false,
              error: "no_local_position",
            });
            continue;
          }
          const result = await executeSwap({
            inputMint: signal.mint,
            outputMint: MINT_SOL,
            amountSol: held.uiAmount * 0.85,
            reason: `copy_sell ${signal.symbol} from ${wallet.slice(0, 8)}…`,
          });
          if (result.ok && !result.dryRun) await bumpTradesToday();
          summary.executed.push({
            signal,
            ok: result.ok,
            signature: result.signature,
            error: result.error,
            dryRun: result.dryRun,
          });
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      summary.errors.push(`${wallet.slice(0, 8)}:${msg}`);
    }
  }

  if (summary.errors.length && summary.executed.every((e) => !e.ok)) {
    summary.ok = false;
  }
  return summary;
}
