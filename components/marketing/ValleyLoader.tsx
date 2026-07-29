"use client";

import { useEffect, useRef } from "react";
import {
  ensureValleyBootClock,
  isValleyBootFinished,
  markValleyBootFinished,
  valleyBootWaitPercent,
  VALLEY_BOOT_CEILING,
  VALLEY_BOOT_DURATION_SEC,
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
 * The fill uses a CSS `scaleX` animation so it keeps moving during WebGL /
 * main-thread stalls (JS rAF freezes; CSS transform usually does not).
 * JS only updates the percent label and finishes to 100% when ready.
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
    const paint = (pct: number, applyScale = false) => {
      const clamped = Math.max(0, Math.min(100, pct));
      const rounded = Math.round(clamped);
      if (applyScale && fillRef.current) {
        fillRef.current.style.transform = `scaleX(${clamped / 100})`;
      }
      if (runnerRef.current) runnerRef.current.style.left = `${clamped}%`;
      if (pctRef.current) pctRef.current.textContent = `${rounded}%`;
      if (rootRef.current) {
        rootRef.current.setAttribute(
          "aria-label",
          `Loading the valley, ${rounded} percent`
        );
      }
    };

    if (isValleyBootFinished()) {
      finishedRef.current = true;
      if (fillRef.current) {
        fillRef.current.style.animation = "none";
        fillRef.current.style.transform = "scaleX(1)";
      }
      paint(100);
      return;
    }

    const elapsed = ensureValleyBootClock();
    const fill = fillRef.current;
    if (fill) {
      fill.style.animation = "none";
      // Force restart so negative delay applies cleanly across remounts.
      void fill.offsetWidth;
      fill.style.animation = `valleyBootScale ${VALLEY_BOOT_DURATION_SEC}s linear forwards`;
      fill.style.animationDelay = `-${Math.min(elapsed, VALLEY_BOOT_DURATION_SEC)}s`;
    }

    let frame = 0;
    let finishing = false;
    let finishFrom = valleyBootWaitPercent(elapsed);
    let finishStart = 0;
    const FINISH_MS = 450;

    paint(valleyBootWaitPercent(elapsed));

    const tick = (now: number) => {
      if (finishedRef.current) return;

      if (readyRef.current && !finishing) {
        finishing = true;
        finishFrom = Math.max(
          valleyBootWaitPercent(ensureValleyBootClock()),
          VALLEY_BOOT_CEILING * 0.15
        );
        finishStart = now;
        if (fillRef.current) {
          fillRef.current.style.animation = "none";
          fillRef.current.style.transform = `scaleX(${finishFrom / 100})`;
        }
      }

      if (finishing) {
        const u = Math.min(1, (now - finishStart) / FINISH_MS);
        const pct = finishFrom + (100 - finishFrom) * u;
        paint(pct, true);
        if (u >= 1) {
          finishedRef.current = true;
          markValleyBootFinished();
          paint(100, true);
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
