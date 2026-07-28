"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { COMMUNITY, PUMP_TICKER_LORE } from "@/lib/community";
import type { PumpTickerPayload } from "@/lib/pump";

const POLL_MS = 30_000;

function formatUsd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(4)}`;
}

function formatSol(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value >= 1000) return `${(value / 1000).toFixed(2)}K SOL`;
  if (value >= 10) return `${value.toFixed(1)} SOL`;
  return `${value.toFixed(2)} SOL`;
}

function TickerItem({
  symbol,
  marketCapUsd,
  marketCapSol,
  isLive,
}: {
  symbol: string;
  marketCapUsd: number | null;
  marketCapSol: number | null;
  isLive: boolean;
}) {
  return (
    <span className="pump-ticker-item">
      <Image
        src="/assets/pump-fun.png"
        alt=""
        width={28}
        height={28}
        className="pump-ticker-pump"
      />
      <span className="pump-ticker-label">Pump.fun</span>
      <span className="pump-ticker-sep" aria-hidden="true">
        ·
      </span>
      <Image
        src="/assets/solana.png"
        alt=""
        width={22}
        height={22}
        className="pump-ticker-sol"
      />
      <span className="pump-ticker-symbol">${symbol}</span>
      <span className="pump-ticker-sep" aria-hidden="true">
        ·
      </span>
      <span className="pump-ticker-meta">
        MC {formatUsd(marketCapUsd)}
      </span>
      <span className="pump-ticker-sep" aria-hidden="true">
        ·
      </span>
      <span className="pump-ticker-meta">{formatSol(marketCapSol)}</span>
      <span className="pump-ticker-sep" aria-hidden="true">
        ·
      </span>
      {isLive ? (
        <span className="pump-ticker-live">
          <span className="pump-ticker-live-dot" aria-hidden="true" />
          LIVE now — coin stream on
        </span>
      ) : (
        <span className="pump-ticker-idle">Trade on Pump.fun</span>
      )}
    </span>
  );
}

/** One half of the marquee — duplicated so translateX(-50%) loops cleanly. */
function TickerHalf({
  symbol,
  marketCapUsd,
  marketCapSol,
  isLive,
  ariaHidden,
}: {
  symbol: string;
  marketCapUsd: number | null;
  marketCapSol: number | null;
  isLive: boolean;
  ariaHidden?: boolean;
}) {
  const props = { symbol, marketCapUsd, marketCapSol, isLive };
  return (
    <span className="pump-ticker-half" aria-hidden={ariaHidden || undefined}>
      <TickerItem {...props} />
      <span className="pump-ticker-bullet" aria-hidden="true">
        ◆
      </span>
      <span className="pump-ticker-lore">{PUMP_TICKER_LORE}</span>
      <span className="pump-ticker-bullet" aria-hidden="true">
        ◆
      </span>
      <TickerItem {...props} />
      <span className="pump-ticker-bullet" aria-hidden="true">
        ◆
      </span>
      <span className="pump-ticker-lore">{PUMP_TICKER_LORE}</span>
      <span className="pump-ticker-bullet" aria-hidden="true">
        ◆
      </span>
    </span>
  );
}

export function PumpTicker() {
  const [data, setData] = useState<PumpTickerPayload | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/pump/ticker", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as PumpTickerPayload;
        if (!cancelled) setData(json);
      } catch {
        // Keep the last good snapshot; the bar still links to Pump.
      }
    }

    void load();
    const id = window.setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const isLive = data?.isLive === true;
  const href = data?.url ?? COMMUNITY.pump;
  const symbol = data?.symbol ?? "Punaab";
  const marketCapUsd = data?.marketCapUsd ?? null;
  const marketCapSol = data?.marketCapSol ?? null;
  const halfProps = { symbol, marketCapUsd, marketCapSol, isLive };

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`pump-ticker${isLive ? " is-live" : ""}`}
      aria-label={
        isLive
          ? `${symbol} is live on Pump.fun — open stream`
          : `${symbol} on Pump.fun — open coin page`
      }
    >
      <span className="pump-ticker-viewport">
        <span className="pump-ticker-track">
          <TickerHalf {...halfProps} />
          <TickerHalf {...halfProps} ariaHidden />
        </span>
      </span>
    </a>
  );
}
