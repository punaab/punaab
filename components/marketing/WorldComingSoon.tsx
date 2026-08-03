"use client";

import { useEffect, useState } from "react";
import { ValleyLoader } from "@/components/marketing/ValleyLoader";
import {
  bumpValleyBoot,
  resetValleyBootClock,
} from "@/lib/bard/valley-boot";

/**
 * /world stage placeholder — keeps the valley boot bar, then reveals a
 * Coming Soon sign instead of mounting the 3D game.
 */
export function WorldComingSoon() {
  const [booting, setBooting] = useState(true);
  const [ready, setReady] = useState(false);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    resetValleyBootClock();
    bumpValleyBoot(4);
    const arm = window.setTimeout(() => {
      bumpValleyBoot(8);
      setReady(true);
    }, 1400);
    return () => window.clearTimeout(arm);
  }, []);

  return (
    <div className="bard-world world-coming-soon">
      {booting ? (
        <ValleyLoader
          ready={ready}
          fading={fading}
          onFinished={() => {
            setFading(true);
            window.setTimeout(() => setBooting(false), 420);
          }}
        />
      ) : (
        <div className="world-coming-soon-sign" role="status">
          <p className="world-coming-soon-eyebrow">Land of Pixelgrew</p>
          <h2>Coming Soon</h2>
          <p>
            The valley is packing its bags. Check back when the road opens.
          </p>
        </div>
      )}
    </div>
  );
}
