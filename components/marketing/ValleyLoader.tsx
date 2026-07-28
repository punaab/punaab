"use client";

import { useEffect, useRef, useState } from "react";
import {
  getValleyBootProgress,
  setValleyBootProgress,
  VALLEY_BOOT_CEILING,
  VALLEY_BOOT_FINISH_RATE,
  VALLEY_BOOT_RATE,
} from "@/lib/bard/valley-boot";

const LORE = [
  "Unfurling the map…",
  "Raising the pines…",
  "Laying the roads…",
  "Tuning the lute…",
  "Summoning the valley…",
];

type ValleyLoaderProps = {
  /** Core scene is up — drain the last stretch to 100%. */
  ready?: boolean;
  fading?: boolean;
  /** Fired once the bar has reached 100 after `ready`. */
  onFinished?: () => void;
};

/**
 * Medieval parchment boot screen for the hero valley.
 *
 * Progress is a steady clock (constant %/s), not asset milestones — main-thread
 * stalls must not produce catch-up spurts. Width is written straight to the DOM
 * so React re-renders do not hitch the bar.
 */
export function ValleyLoader({
  ready = false,
  fading = false,
  onFinished,
}: ValleyLoaderProps) {
  const [line, setLine] = useState(0);
  const fillRef = useRef<HTMLDivElement>(null);
  const runnerRef = useRef<HTMLSpanElement>(null);
  const pctRef = useRef<HTMLSpanElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const readyRef = useRef(ready);
  const finishedRef = useRef(false);
  const onFinishedRef = useRef(onFinished);

  readyRef.current = ready;
  onFinishedRef.current = onFinished;

  useEffect(() => {
    const id = window.setInterval(
      () => setLine((n) => (n + 1) % LORE.length),
      1700
    );
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let last = performance.now();
    // Fresh visit after a prior load finished — don't open at 100%.
    let value = getValleyBootProgress();
    if (value >= 100) value = 0;
    let frame = 0;

    const paint = (pct: number) => {
      const rounded = Math.max(0, Math.min(100, Math.round(pct)));
      if (fillRef.current) fillRef.current.style.width = `${pct}%`;
      if (runnerRef.current) runnerRef.current.style.left = `${pct}%`;
      if (pctRef.current) pctRef.current.textContent = `${rounded}%`;
      if (rootRef.current) {
        rootRef.current.setAttribute(
          "aria-label",
          `Loading the valley, ${rounded} percent`
        );
      }
    };

    paint(value);

    const tick = (now: number) => {
      // Cap dt so a long stall cannot dump a burst of catch-up into one frame.
      // We intentionally do *not* make up the missed wall time — that was the
      // spurt. The bar just resumes at the same steady rate.
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;

      if (readyRef.current) {
        value = Math.min(100, value + VALLEY_BOOT_FINISH_RATE * dt);
      } else if (value < VALLEY_BOOT_CEILING) {
        value = Math.min(VALLEY_BOOT_CEILING, value + VALLEY_BOOT_RATE * dt);
      } else {
        // Past the expected window: creep so it never looks frozen at 92.
        value = Math.min(96, value + 1.2 * dt);
      }

      setValleyBootProgress(value);
      paint(value);

      if (value >= 99.5 && readyRef.current && !finishedRef.current) {
        finishedRef.current = true;
        paint(100);
        setValleyBootProgress(100);
        onFinishedRef.current?.();
        return;
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const initialPct = Math.round(getValleyBootProgress());

  return (
    <div
      ref={rootRef}
      className={`valley-loader${fading ? " is-fading" : ""}`}
      role="status"
      aria-live="polite"
      aria-busy={!fading}
      aria-label={`Loading the valley, ${initialPct} percent`}
    >
      <div className="valley-loader-glow" aria-hidden="true" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/assets/backpack.svg"
        alt=""
        className="valley-loader-backpack"
        width={120}
        height={120}
        draggable={false}
      />
      <div className="valley-loader-panel">
        <span className="valley-loader-corner tl" aria-hidden="true" />
        <span className="valley-loader-corner tr" aria-hidden="true" />
        <span className="valley-loader-corner bl" aria-hidden="true" />
        <span className="valley-loader-corner br" aria-hidden="true" />

        <p className="valley-loader-title">The Open Road</p>
        <p className="valley-loader-line" key={line}>
          {LORE[line]}
        </p>

        <div className="valley-loader-track" aria-hidden="true">
          <span className="valley-loader-cap left" />
          <div className="valley-loader-trough">
            <div
              ref={fillRef}
              className="valley-loader-fill"
              style={{ width: `${getValleyBootProgress()}%` }}
            >
              <span className="valley-loader-shimmer" />
            </div>
            <span
              ref={runnerRef}
              className="valley-loader-runner"
              style={{ left: `${getValleyBootProgress()}%` }}
            />
          </div>
          <span className="valley-loader-cap right" />
        </div>

        <div className="valley-loader-meta">
          <span className="valley-loader-rule" aria-hidden="true" />
          <span ref={pctRef} className="valley-loader-pct">
            {initialPct}%
          </span>
          <span className="valley-loader-rule" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
