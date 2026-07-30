"use client";

import { useThree } from "@react-three/fiber";
import {
  Bloom,
  EffectComposer,
  Vignette,
  SMAA,
  BrightnessContrast,
  HueSaturation,
} from "@react-three/postprocessing";
import { BlendFunction, type BloomEffect } from "postprocessing";
import { Component, useEffect, useState, type ReactNode } from "react";
import type * as THREE from "three";

/**
 * Postprocessing lives in its own module so `postprocessing` and
 * `@react-three/postprocessing` land in their own chunk. Nothing here is
 * needed to draw the first frame of the valley — the composer only mounts
 * once the world enriches — so keeping it out of the stage's critical chunk
 * takes a few hundred kilobytes of download and parse off the boot path.
 */

/** True when the canvas still has a live WebGL context we can query. */
function hasLiveGl(gl: THREE.WebGLRenderer): boolean {
  try {
    const ctx = gl.getContext();
    return Boolean(ctx?.getContextAttributes?.());
  } catch {
    return false;
  }
}

/**
 * Isolates postprocessing so a composer crash (lost context, library bug)
 * cannot take down the whole valley Canvas.
 */
class PostFxBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn("[punaab] postprocessing disabled after error:", error);
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

/**
 * Bloom / SMAA / grade — deferred until the renderer reports a live context.
 *
 * `postprocessing` reads `gl.getContext().getContextAttributes().alpha` when
 * building framebuffers. After a Canvas remount or a lost context that call
 * returns null and throws; mounting one frame late and gating on attributes
 * avoids the crash, and the boundary keeps the stage up if it still fails.
 */
export function ValleyPostFx({
  bloomRef,
}: {
  bloomRef: React.MutableRefObject<BloomEffect | null>;
}) {
  const gl = useThree((state) => state.gl);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    let alive = true;
    let attempts = 0;
    let raf = 0;

    const arm = () => {
      if (!alive) return;
      if (hasLiveGl(gl)) {
        setArmed(true);
        return;
      }
      if (attempts++ < 45) {
        raf = requestAnimationFrame(arm);
      }
    };

    // Two frames after enrich mounts — lets R3F finish sizing the renderer.
    raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(arm);
    });

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      setArmed(false);
      bloomRef.current = null;
    };
  }, [gl, bloomRef]);

  if (!armed) return null;

  return (
    <PostFxBoundary>
      <EffectComposer multisampling={0} enableNormalPass={false}>
        <SMAA />
        {/*
          Bloom only on genuinely bright things — the sun, the campfire, lit
          windows. A low threshold would fog the whole image, which is the
          most common way postprocessing makes a scene look worse.

          That threshold is right for daylight and wrong for night, when
          the brightest things in frame *are* the lamps. `NightGrade` in
          BardWorld walks it down after dark; a fixed value either washes
          out noon or leaves every light source in the valley flat after dusk.
        */}
        <Bloom
          // Object refs break @react-three/postprocessing under React 19:
          // wrapEffect memoizes with JSON.stringify(props), and once the
          // ref points at the live effect graph that walk is circular.
          // Callback refs are dropped by stringify, so they stay safe.
          ref={(effect: BloomEffect | null) => {
            bloomRef.current = effect;
          }}
          intensity={0.55}
          luminanceThreshold={0.84}
          luminanceSmoothing={0.32}
          mipmapBlur
        />
        {/* Warm Ghibli push — cream haze, soft contrast. */}
        <HueSaturation saturation={0.06} hue={0.015} />
        <BrightnessContrast brightness={0.018} contrast={0.055} />
        <Vignette
          offset={0.32}
          darkness={0.42}
          blendFunction={BlendFunction.NORMAL}
        />
      </EffectComposer>
    </PostFxBoundary>
  );
}
