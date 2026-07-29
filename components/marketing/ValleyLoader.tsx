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
 * Stage boot bar — smooth fill + steadily ticking percent.
 *
 * Displayed progress lerps toward a slow predicted target every frame.
 * The integer label only rises, and an anti-stall tick keeps it from parking
 * on one number while the float is still creeping up.
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
    const paint = (pct: number, label: number) => {
      const clamped = Math.max(0, Math.min(100, pct));
      if (fillRef.current) {
        fillRef.current.style.transform = `scaleX(${clamped / 100})`;
      }
      if (runnerRef.current) {
        runnerRef.current.style.left = `${clamped}%`;
      }
      if (pctRef.current) {
        pctRef.current.textContent = `${label}%`;
      }
      if (rootRef.current) {
        rootRef.current.setAttribute(
          "aria-label",
          `Loading the valley, ${label} percent`
        );
      }
    };

    if (isValleyBootFinished()) {
      finishedRef.current = true;
      paint(100, 100);
      return;
    }

    let frame = 0;
    let finishing = false;
    let finishFrom = 0;
    let finishStart = 0;
    let display = valleyBootWaitPercent(ensureValleyBootClock());
    let shownLabel = Math.floor(display);
    let lastTs = performance.now();
    let lastLabelAt = lastTs;

    paint(display, shownLabel);

    const tick = (now: number) => {
      if (finishedRef.current) return;
      const dt = Math.min(0.05, Math.max(0, (now - lastTs) / 1000));
      lastTs = now;

      if (readyRef.current && !finishing) {
        finishing = true;
        finishFrom = display;
        finishStart = now;
      }

      let target: number;
      if (finishing) {
        const u = Math.min(1, (now - finishStart) / VALLEY_BOOT_FINISH_MS);
        const eased = 1 - Math.pow(1 - u, 2.6);
        target = finishFrom + (100 - finishFrom) * eased;
      } else {
        target = valleyBootWaitPercent(ensureValleyBootClock());
      }

      // Smooth chase — patient while waiting, snappier on the final stretch.
      const follow = finishing ? 12 : 4.5;
      display += (target - display) * Math.min(1, 1 - Math.exp(-follow * dt));
      if (!finishing && display < target) {
        // Guaranteed crawl so float (and bar) never sit still under target.
        display = Math.min(target, display + 0.55 * dt);
      }
      display = Math.min(finishing ? 100 : target, Math.max(0, display));

      const floor = Math.floor(display);
      if (floor > shownLabel) {
        shownLabel = floor;
        lastLabelAt = now;
      } else if (
        !finishing &&
        shownLabel < 96 &&
        display >= shownLabel + 0.55 &&
        now - lastLabelAt > 700
      ) {
        // Anti-stall: if we've been on one integer too long but float moved, tick.
        shownLabel += 1;
        lastLabelAt = now;
      }

      paint(display, Math.min(finishing ? 100 : 97, shownLabel));

      if (finishing && display >= 99.7) {
        finishedRef.current = true;
        markValleyBootFinished();
        paint(100, 100);
        onFinishedRef.current?.();
        return;
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const initial = valleyBootWaitPercent(ensureValleyBootClock());
  const initialPct = Math.floor(initial);

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
              style={{ transform: `scaleX(${initial / 100})` }}
            >
              <span className="valley-loader-shimmer" />
            </div>
            <span
              ref={runnerRef}
              className="valley-loader-runner"
              style={{ left: `${initial}%` }}
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
