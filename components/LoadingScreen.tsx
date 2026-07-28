"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

export function LoadingScreen() {
  const [percent, setPercent] = useState(0);
  const [hidden, setHidden] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const seen = sessionStorage.getItem("punaab-loader-done");
    if (seen) {
      setHidden(true);
      return;
    }

    setHidden(false);
    const start = performance.now();
    const duration = 2000;
    let frame = 0;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setPercent(Math.round(t * 100));
      if (t < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        sessionStorage.setItem("punaab-loader-done", "1");
        window.setTimeout(() => setHidden(true), 280);
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  if (!mounted || hidden) return null;

  return (
    <div className={`loader-screen${percent >= 100 ? " loader-fade" : ""}`}>
      <div className="loader-content">
        <Image
          src="/assets/punaab-wink.png"
          alt="Punaab"
          width={140}
          height={140}
          className="loader-mascot"
          priority
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
        <div className="loader-spinner-wrapper">
          <div className="loader-spinner" />
        </div>
        <div className="loader-progress-wrapper">
          <div
            className="loader-progress-bar"
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="loader-percentage">{percent}%</div>
      </div>
    </div>
  );
}
