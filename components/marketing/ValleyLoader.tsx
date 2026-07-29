"use client";

import { useEffect, useRef } from "react";
import {
  ensureValleyBootClock,
  isValleyBootFinished,
  markValleyBootFinished,
  valleyBootWaitPercent,
  VALLEY_BOOT_FINISH_MS,
} from "@/lib/bard/valley-boot";

type ValleyLoaderProps = {
  /** Core scene is up — drain the last stretch to 100%. */
  ready?: boolean;
  fading?: boolean;
  /** Fired once the bar has reached 100 after `ready`. */
  onFinished?: () => void;
};

/**
 * Stage boot bar.
 *
 * Fill, diamond, and percent are painted from one progress value every frame
 * so they cannot drift apart. While waiting, progress asymptotes toward a soft
 * ceiling (slower the longer the load). When `ready`, it eases the rest to 100.
 */
export function ValleyLoader({
  ready = false,
  fading = false,
  onFinished,
}: ValleyLoaderProps) {
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
    const paint = (pct: number) => {
      const clamped = Math.max(0, Math.min(100, pct));
      const rounded = Math.round(clamped);
      if (fillRef.current) {
        fillRef.current.style.transform = `scaleX(${clamped / 100})`;
      }
      if (runnerRef.current) {
        runnerRef.current.style.left = `${clamped}%`;
      }
      if (pctRef.current) {
        pctRef.current.textContent = `${rounded}%`;
      }
      if (rootRef.current) {
        rootRef.current.setAttribute(
          "aria-label",
          `Loading the valley, ${rounded} percent`
        );
      }
    };

    if (isValleyBootFinished()) {
      finishedRef.current = true;
      paint(100);
      return;
    }

    let frame = 0;
    let finishing = false;
    let finishFrom = 0;
    let finishStart = 0;

    // Resume wherever the shared clock already is (lazy loader → BardWorld).
    paint(valleyBootWaitPercent(ensureValleyBootClock()));

    const tick = (now: number) => {
      if (finishedRef.current) return;

      if (readyRef.current && !finishing) {
        finishing = true;
        finishFrom = valleyBootWaitPercent(ensureValleyBootClock());
        finishStart = now;
      }

      if (finishing) {
        const u = Math.min(1, (now - finishStart) / VALLEY_BOOT_FINISH_MS);
        // Ease-out so the last stretch settles instead of slamming.
        const eased = 1 - (1 - u) * (1 - u);
        const pct = finishFrom + (100 - finishFrom) * eased;
        paint(pct);
        if (u >= 1) {
          finishedRef.current = true;
          markValleyBootFinished();
          paint(100);
          onFinishedRef.current?.();
          return;
        }
      } else {
        paint(valleyBootWaitPercent(ensureValleyBootClock()));
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const initialPct = Math.round(valleyBootWaitPercent(ensureValleyBootClock()));

  return (
    <div
      ref={rootRef}
      className={`valley-loader valley-loader-bar${fading ? " is-fading" : ""}`}
      role="status"
      aria-live="polite"
      aria-busy={!fading}
      aria-label={`Loading the valley, ${initialPct} percent`}
    >
      <div className="valley-loader-glow" aria-hidden="true" />
      <div className="valley-loader-bar-panel">
        <div className="valley-loader-track" aria-hidden="true">
          <span className="valley-loader-cap left" />
          <div className="valley-loader-trough">
            <div
              ref={fillRef}
              className="valley-loader-fill valley-loader-fill-boot"
              style={{ transform: `scaleX(${initialPct / 100})` }}
            >
              <span className="valley-loader-shimmer" />
            </div>
            <span
              ref={runnerRef}
              className="valley-loader-runner"
              style={{ left: `${initialPct}%` }}
            />
          </div>
          <span className="valley-loader-cap right" />
        </div>
        <span ref={pctRef} className="valley-loader-pct">
          {initialPct}%
        </span>
      </div>
    </div>
  );
}
