"use client";

import { useEffect, useRef } from "react";

/**
 * Keeps “LAND OF PIXELGREW” on one line by shrinking the display font until
 * it fits the head — Cinzel caps are too wide for a fixed vw formula alone.
 */
export function TravelPageTitle({ children }: { children: string }) {
  const ref = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const fit = () => {
      const parent = el.parentElement;
      if (!parent) return;
      const budget = Math.max(0, parent.clientWidth - 4);
      if (budget < 8) return;
      const maxPx = Math.min(44, Math.floor(window.innerWidth * 0.09));
      const minPx = 10;
      let lo = minPx;
      let hi = maxPx;
      let best = minPx;
      for (let i = 0; i < 18; i++) {
        const mid = (lo + hi) / 2;
        el.style.fontSize = `${mid}px`;
        if (el.scrollWidth <= budget) {
          best = mid;
          lo = mid;
        } else {
          hi = mid;
        }
      }
      // Slightly under the max that fitted — Cinzel metrics can round up a hair.
      el.style.fontSize = `${Math.max(minPx, best * 0.98)}px`;
    };

    fit();
    // Fonts / layout may land after first paint.
    const fontsReady =
      typeof document !== "undefined" && "fonts" in document
        ? document.fonts.ready.then(fit)
        : Promise.resolve();

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => fit())
        : null;
    if (el.parentElement) ro?.observe(el.parentElement);
    window.addEventListener("resize", fit);

    return () => {
      void fontsReady;
      ro?.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [children]);

  return (
    <h1 ref={ref} className="travel-page-title">
      {children}
    </h1>
  );
}
