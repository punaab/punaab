"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { ValleyLoader } from "@/components/marketing/ValleyLoader";
import { resetValleyBootClock } from "@/lib/bard/valley-boot";

/**
 * The hero world is three.js plus a scene that generates its own terrain,
 * flora and textures on the client. It is code-split so it never blocks first
 * paint, and never server-rendered — there is no WebGL context on the server
 * to render it into.
 */
const BardWorld = dynamic(
  () => import("@/components/world/BardWorld").then((m) => m.BardWorld),
  {
    ssr: false,
    loading: () => (
      <div className="bard-world">
        <ValleyLoader />
      </div>
    ),
  }
);

export function BardWorldLazy() {
  const started = useRef(false);
  if (!started.current) {
    started.current = true;
    resetValleyBootClock();
  }
  useEffect(() => {
    return () => {
      started.current = false;
    };
  }, []);

  return <BardWorld />;
}
