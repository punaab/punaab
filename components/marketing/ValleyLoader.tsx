"use client";

import { useEffect, useState } from "react";

const LORE = [
  "Unfurling the map…",
  "Raising the pines…",
  "Laying the roads…",
  "Tuning the lute…",
  "Summoning the valley…",
];

type ValleyLoaderProps = {
  /** 0–100. When omitted, the bar drifts forward on its own. */
  progress?: number;
  fading?: boolean;
};

/**
 * Medieval parchment boot screen for the hero valley.
 * Covers the black WebGL stage while the chunk and scene come up.
 */
export function ValleyLoader({ progress, fading = false }: ValleyLoaderProps) {
  const [line, setLine] = useState(0);
  const [drift, setDrift] = useState(6);

  useEffect(() => {
    const id = window.setInterval(
      () => setLine((n) => (n + 1) % LORE.length),
      1700
    );
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (progress != null) return;
    // Chunk-download fallback: same steady linear rate as the in-stage boot.
    let last = performance.now();
    let value = 0;
    let frame = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      value = Math.min(88, value + 22 * dt);
      setDrift(value);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [progress]);

  const pct = Math.max(
    0,
    Math.min(100, Math.round(progress != null ? progress : drift))
  );

  return (
    <div
      className={`valley-loader${fading ? " is-fading" : ""}`}
      role="status"
      aria-live="polite"
      aria-busy={!fading}
      aria-label={`Loading the valley, ${pct} percent`}
    >
      <div className="valley-loader-glow" aria-hidden="true" />
      <div className="valley-loader-panel">
        <span className="valley-loader-corner tl" aria-hidden="true" />
        <span className="valley-loader-corner tr" aria-hidden="true" />
        <span className="valley-loader-corner bl" aria-hidden="true" />
        <span className="valley-loader-corner br" aria-hidden="true" />

        <div className="valley-loader-crest" aria-hidden="true">
          <svg viewBox="0 0 64 64" className="valley-loader-lyre">
            <path
              d="M18 10c0 8 4 14 8 18v24h4V28c4-4 8-10 8-18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
            <path
              d="M22 14c2 6 5 10 7 13M34 14c-2 6-5 10-7 13"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              opacity="0.7"
            />
            <circle cx="28" cy="48" r="3.2" fill="currentColor" />
            <path
              d="M12 22h8M36 22h8"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          <span className="valley-loader-seal">P</span>
        </div>

        <p className="valley-loader-title">The Open Road</p>
        <p className="valley-loader-line" key={line}>
          {LORE[line]}
        </p>

        <div className="valley-loader-track" aria-hidden="true">
          <span className="valley-loader-cap left" />
          <div className="valley-loader-trough">
            <div
              className="valley-loader-fill"
              style={{ width: `${pct}%` }}
            >
              <span className="valley-loader-shimmer" />
            </div>
            <span
              className="valley-loader-runner"
              style={{ left: `${pct}%` }}
            />
          </div>
          <span className="valley-loader-cap right" />
        </div>

        <div className="valley-loader-meta">
          <span className="valley-loader-rule" aria-hidden="true" />
          <span className="valley-loader-pct">{pct}%</span>
          <span className="valley-loader-rule" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
