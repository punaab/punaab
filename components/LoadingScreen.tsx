"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

const BOOT_FLAG = "punaab-loader-done";
const BOOT_CLASS = "punaab-booting";

function isBooting(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains(BOOT_CLASS);
}

function clearBootClass() {
  if (typeof document === "undefined") return;
  document.documentElement.classList.remove(BOOT_CLASS);
}

/**
 * First-visit full-page boot. A blocking layout script adds `punaab-booting`
 * before paint so the page never flashes underneath — this component then
 * owns the animated bar and clears the class when finished.
 */
export function LoadingScreen() {
  // Always start inactive so SSR and hydration match. The pre-paint
  // `punaab-booting` veil covers the page until this mounts the real loader.
  const [active, setActive] = useState(false);
  const [percent, setPercent] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (!isBooting()) {
      clearBootClass();
      setActive(false);
      return;
    }

    setActive(true);
    const start = performance.now();
    const duration = 2000;
    let frame = 0;
    let fadeTimer = 0;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setPercent(Math.round(t * 100));
      if (t < 1) {
        frame = requestAnimationFrame(tick);
        return;
      }
      try {
        sessionStorage.setItem(BOOT_FLAG, "1");
      } catch {
        /* private mode */
      }
      setFading(true);
      fadeTimer = window.setTimeout(() => {
        clearBootClass();
        setActive(false);
      }, 450);
    };

    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(fadeTimer);
    };
  }, []);

  if (!active) return null;

  return (
    <div
      className={`loader-screen${fading ? " loader-fade" : ""}`}
      role="status"
      aria-live="polite"
      aria-busy={!fading}
      aria-label={`Loading, ${percent} percent`}
    >
      <div className="loader-content">
        <Image
          src="/assets/backpack.svg"
          alt="Punaab's backpack"
          width={180}
          height={180}
          className="loader-mascot"
          priority
          unoptimized
        />
        <div className="loader-code-text">
          <span className="code-line" data-line="1">
            Punaab stirs…
          </span>
          <span className="code-line" data-line="2">
            Tuning the lute…
          </span>
          <span className="code-line" data-line="3">
            Charting the roads…
          </span>
          <span className="code-line" data-line="4">
            The journey begins.
          </span>
        </div>

        <div className="valley-loader-track loader-boot-track" aria-hidden="true">
          <span className="valley-loader-cap left" />
          <div className="valley-loader-trough">
            <div
              className="valley-loader-fill"
              style={{ width: `${percent}%` }}
            >
              <span className="valley-loader-shimmer" />
            </div>
            <span
              className="valley-loader-runner"
              style={{ left: `${percent}%` }}
            />
          </div>
          <span className="valley-loader-cap right" />
        </div>

        <div className="valley-loader-meta">
          <span className="valley-loader-rule" aria-hidden="true" />
          <span className="valley-loader-pct">{percent}%</span>
          <span className="valley-loader-rule" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
