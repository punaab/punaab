"use client";

import { useEffect, useRef } from "react";

/**
 * On first paint of /world, scroll so the 3D stage sits in the middle of the
 * viewport (header + title above, actions below — not stuck under the fold).
 */
export function WorldStageFocus({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const center = () => {
      el.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: "auto",
      });
    };

    // Layout may still be settling (fonts, stage height) — center twice.
    center();
    const t = window.setTimeout(center, 120);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div ref={ref} className="travel-stage-frame" id="travel-stage">
      {children}
    </div>
  );
}
