"use client";

import { useEffect, useRef } from "react";
import {
  getValleyBootProgress,
  setValleyBootProgress,
  valleyBootProgressAt,
  VALLEY_BOOT_ASYMPTOTE,
  VALLEY_BOOT_FINISH_RATE,
  VALLEY_BOOT_TAU_SEC,
} from "@/lib/bard/valley-boot";

type ValleyLoaderProps = {
  /** Core scene is up — drain the last stretch to 100%. */
  ready?: boolean;
  fading?: boolean;
  /** Fired once the bar has reached 100 after `ready`. */
  onFinished?: () => void;
};

/**
 * Compact stage boot bar for the valley.
 *
 * Progress follows wall-clock time on a smooth asymptote so the bar never
 * hard-stalls at a fake ceiling. When the scene signals ready, it finishes
 * the last stretch at a steady rate.
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
    let value = getValleyBootProgress();
    if (value >= 100) value = 0;

    // Resume the wall-clock curve from the shared percent so the lazy-chunk
    // loader → BardWorld handoff does not jump backward.
    let elapsedAtStart = 0;
    if (value > 0.5 && value < VALLEY_BOOT_ASYMPTOTE) {
      const ratio = Math.min(0.999, value / VALLEY_BOOT_ASYMPTOTE);
      elapsedAtStart = -VALLEY_BOOT_TAU_SEC * Math.log(1 - ratio);
    }
    const start = performance.now() - elapsedAtStart * 1000;
    let last = performance.now();
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
      const dt = Math.min(0.08, Math.max(0, (now - last) / 1000));
      last = now;

      if (readyRef.current) {
        value = Math.min(100, value + VALLEY_BOOT_FINISH_RATE * dt);
      } else {
        // Wall-clock asymptote — after a main-thread hitch the bar lands where
        // elapsed time says it should, then keeps easing forward.
        value = valleyBootProgressAt((now - start) / 1000);
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
        <span ref={pctRef} className="valley-loader-pct">
          {initialPct}%
        </span>
      </div>
    </div>
  );
}
