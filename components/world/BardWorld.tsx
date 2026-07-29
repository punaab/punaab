"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { AdaptiveDpr, Preload } from "@react-three/drei";
import {
  Bloom,
  EffectComposer,
  Vignette,
  SMAA,
  BrightnessContrast,
  HueSaturation,
} from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";

import { Architecture } from "./Architecture";
import { Atmosphere } from "./Atmosphere";
import { Bard } from "./Bard";
import { Flora } from "./Flora";
import { FollowCamera } from "./FollowCamera";
import { NPCs } from "./NPCs";
import { SpeechBubble, type BubbleKind } from "./SpeechBubble";
import { WorldMap } from "./WorldMap";
import { findPlace } from "@/lib/world/cartography";
import { Terrain } from "./Terrain";
import { Water } from "./Water";
import { ensureWorldColliders } from "@/lib/world/world-colliders";
import { ValleyLoader } from "@/components/marketing/ValleyLoader";

import {
  AdventureDirector,
  SONG_INTRO_LINES,
  type Activity,
  type Stop,
} from "@/lib/bard/adventure";
import { loadLocalJourney, saveLocalJourney } from "@/lib/bard/local-journey";
import {
  BardPerformance,
  EMPTY_MUSIC_LEVELS,
  type MusicLevels,
} from "@/lib/bard/performance";
import { walkAmbience } from "@/lib/bard/walk-ambience";
import { budgetFor, detectQuality, type QualityBudget } from "@/lib/world/quality";

/**
 * The hero scene: Punaab travelling a fantasy valley, followed by a camera,
 * singing songs he plays one note at a time.
 *
 * State discipline matters a lot here. Anything that changes per frame —
 * position, pluck triggers, activity — lives in refs and never touches React,
 * because a `setState` at 60fps would re-render the scene graph 60 times a
 * second. Only things that change every few *seconds* (the bubble text, the
 * caption, the audio toggle) are React state.
 */

type Bubble = { text: string; kind: BubbleKind } | null;

function Scene({
  budget,
  director,
  bardRef,
  headAnchorRef,
  pluckSignal,
  singing,
  playingMusic,
  activity,
  bubble,
  onActivityChange,
  sampleMusic,
  enrichWorld,
  onCoreReady,
}: {
  budget: QualityBudget;
  director: AdventureDirector;
  bardRef: React.RefObject<THREE.Object3D | null>;
  headAnchorRef: React.RefObject<THREE.Object3D | null>;
  pluckSignal: React.RefObject<number>;
  singing: React.RefObject<boolean>;
  playingMusic: React.RefObject<boolean>;
  activity: React.RefObject<Activity>;
  bubble: Bubble;
  onActivityChange: (activity: Activity) => void;
  sampleMusic: React.RefObject<() => MusicLevels>;
  /** Trees, buildings, NPCs — mounted after the loader dismisses. */
  enrichWorld: boolean;
  onCoreReady: () => void;
}) {
  // Every building and NPC has to be in the collision registry BEFORE anything
  // takes a step, or the first frames of movement pass straight through the
  // world. Doing it here — during render, before the bard and the NPCs mount —
  // rather than in an effect is deliberate: effects run after children have
  // already had a frame to move. Shared pathing always uses the medium set so
  // every visitor agrees on where the walls are.
  ensureWorldColliders(budgetFor("medium"));

  // Bump when placement/footing code changes so Fast Refresh cannot keep a
  // floating architecture graph alive across edits.
  const worldRev = 10;

  const lastActivity = useRef<Activity>("travelling");

  const handleFrame = useCallback(
    (_position: THREE.Vector3, next: Activity) => {
      activity.current = next;
      if (next !== lastActivity.current) {
        lastActivity.current = next;
        onActivityChange(next);
      }
    },
    [activity, onActivityChange]
  );

  return (
    <>
      <Atmosphere target={bardRef} budget={budget} />
      <Terrain segments={budget.terrainSegments} />
      <Water reflective={budget.waterReflections} />
      {/* First paint: meadow + roadside grass only — keeps the loader short. */}
      <Flora key={`flora-grass-${worldRev}`} budget={budget} layers="grass" />

      <Bard
        director={director}
        bardRef={bardRef}
        headAnchorRef={headAnchorRef}
        pluckSignal={pluckSignal}
        singing={singing}
        playingMusic={playingMusic}
        activity={activity}
        onFrame={handleFrame}
        sampleMusic={sampleMusic}
      />

      <SpeechBubble
        anchor={headAnchorRef}
        text={bubble?.text ?? null}
        kind={bubble?.kind}
      />

      <FollowCamera target={bardRef} activity={activity} />
      <SceneReadySignal onReady={onCoreReady} />

      {enrichWorld && (
        <>
          <Flora
            key={`flora-canopy-${worldRev}`}
            budget={budget}
            layers="canopy"
          />
          <Architecture key={`arch-${worldRev}`} budget={budget} />
          <NPCs budget={budget} />

          {budget.postprocessing && (
            <EffectComposer multisampling={0} enableNormalPass={false}>
              <SMAA />
              {/*
                Bloom only on genuinely bright things — the sun, the campfire, lit
                windows. A low threshold would fog the whole image, which is the
                most common way postprocessing makes a scene look worse.
              */}
              <Bloom
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
          )}

          <Preload all />
        </>
      )}

      <AdaptiveDpr pixelated />
    </>
  );
}

/** Fires once the Suspense tree has drawn a few frames — valley is visible. */
function SceneReadySignal({ onReady }: { onReady: () => void }) {
  const frames = useRef(0);
  const sent = useRef(false);
  useFrame(() => {
    if (sent.current) return;
    frames.current += 1;
    if (frames.current < 3) return;
    sent.current = true;
    onReady();
  });
  return null;
}

export function BardWorld() {
  // Probed once, lazily. This component is only ever loaded with `ssr: false`,
  // so there is no server render to mismatch against — which means the device
  // probe can seed initial state directly instead of landing in an effect and
  // costing an extra render on mount.
  const [budget] = useState<QualityBudget>(detectQuality);
  const [bubble, setBubble] = useState<Bubble>(null);
  const [audioOn, setAudioOn] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  // Which place he is standing at, so the map can mark it. Only ever changes
  // on arrival and departure, so it is cheap React state rather than a ref.
  const [currentPlaceId, setCurrentPlaceId] = useState<string | null>(null);
  const [nowPlaying, setNowPlaying] = useState<string | null>(null);
  const [nowPlayingOverflows, setNowPlayingOverflows] = useState(false);
  const [caption, setCaption] = useState("Punaab is on the road.");
  // Paint the medieval loader for a frame before mounting WebGL + flora bake,
  // otherwise the stage just sits black while the main thread is busy.
  const [bootScene, setBootScene] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [enrichWorld, setEnrichWorld] = useState(false);
  const [loaderFading, setLoaderFading] = useState(false);
  const [showLoader, setShowLoader] = useState(true);

  const bardRef = useRef<THREE.Object3D | null>(null);
  const headAnchorRef = useRef<THREE.Object3D | null>(null);
  const nowPlayingTextRef = useRef<HTMLSpanElement | null>(null);
  const nowPlayingViewportRef = useRef<HTMLDivElement | null>(null);
  const nowPlayingChipRef = useRef<HTMLDivElement | null>(null);
  const nowPlayingSlotRef = useRef<HTMLDivElement | null>(null);
  const pluckSignal = useRef(0);
  const singing = useRef(false);
  const playingMusic = useRef(false);
  const activity = useRef<Activity>("travelling");
  const audioOnRef = useRef(false);
  const lyricLine = useRef<string[]>([]);
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const captionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let outer = 0;
    let inner = 0;
    outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setBootScene(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, []);

  const handleSceneReady = useCallback(() => {
    setSceneReady(true);
  }, []);

  const handleLoaderFinished = useCallback(() => {
    setLoaderFading(true);
    window.setTimeout(() => setShowLoader(false), 560);
  }, []);

  // Core (bard + grass) is up — dismiss the loader, then stream in the rest.
  useEffect(() => {
    if (!sceneReady) return;
    const t = window.setTimeout(() => setEnrichWorld(true), 160);
    return () => window.clearTimeout(t);
  }, [sceneReady]);

  const performance = useMemo(() => new BardPerformance(), []);
  const sampleMusic = useRef<() => MusicLevels>(() => EMPTY_MUSIC_LEVELS);
  sampleMusic.current = () => performance.sampleLevels();

  const say = useCallback((text: string, kind: BubbleKind = "speech") => {
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    setBubble({ text, kind });
    // Reading pace + linger; SpeechBubble adds its own fade-out after this.
    const duration = Math.max(5600, text.length * 110);
    bubbleTimer.current = setTimeout(() => setBubble(null), duration);
  }, []);

  // --- The adventure ------------------------------------------------------
  // Callbacks live on a ref so the director is constructed once — remounting
  // him snaps Punaab back to Wanderer's Cross every time `say` identity changes.
  const adventureCallbacks = useRef({
    onSay: (_line: string, _activity: Activity) => {},
    onArrive: (_stop: Stop) => {},
    onTrade: (_waresTag: string, _stop: Stop) => {},
    onLore: (_loreId: string, _stop: Stop) => {},
    onDepart: (_stop: Stop) => {},
  });

  adventureCallbacks.current = {
    onSay: (line, currentActivity) => {
      say(line, currentActivity === "wondering" ? "thought" : "speech");
    },
    onArrive: (stop: Stop) => {
      setCurrentPlaceId(stop.id);
      setCaption(captionFor(stop));
      if (captionTimer.current) clearTimeout(captionTimer.current);
      // Keep the stop caption for most of the dwell so it isn't a flash.
      const lingerMs = Math.max(12_000, (stop.dwell || 14) * 900);
      captionTimer.current = setTimeout(() => {
        setCaption("Punaab is on the road.");
      }, lingerMs);
      if (audioOnRef.current && stop.songId) {
        // One random track from the repertoire — never a fixed setlist.
        void performance.play();
      }
    },
    onTrade: (_waresTag, stop) => {
      setCaption(`Punaab is trading at ${stop.name}.`);
    },
    onLore: (_loreId, stop) => {
      say(`Something worth remembering at ${stop.name}.`, "thought");
    },
    onDepart: () => {
      setCurrentPlaceId(null);
      setCaption("Punaab is on the road.");
    },
  };

  const director = useMemo(() => {
    ensureWorldColliders(budgetFor("medium"));
    const next = new AdventureDirector({
      onSay: (line, activity) =>
        adventureCallbacks.current.onSay(line, activity),
      onArrive: (stop) => adventureCallbacks.current.onArrive(stop),
      onTrade: (waresTag, stop) =>
        adventureCallbacks.current.onTrade(waresTag, stop),
      onLore: (loreId, stop) =>
        adventureCallbacks.current.onLore(loreId, stop),
      onDepart: (stop) => adventureCallbacks.current.onDepart(stop),
    });
    const saved = loadLocalJourney();
    if (saved) next.restore(saved);
    return next;
  }, []);

  // Remember where he was on this browser only — not shared across visitors.
  useEffect(() => {
    const persist = () => saveLocalJourney(director);
    const interval = window.setInterval(persist, 4_000);
    const onHide = () => {
      if (document.visibilityState === "hidden") persist();
    };
    window.addEventListener("beforeunload", persist);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("beforeunload", persist);
      document.removeEventListener("visibilitychange", onHide);
      persist();
    };
  }, [director]);

  // --- Audio events -> animation and bubbles ------------------------------
  useEffect(() => {
    const off = performance.on((event) => {
      switch (event.type) {
        case "note":
          // A counter rather than a boolean: the animation reads the change,
          // so repeated notes at any rate each land as a distinct pluck.
          pluckSignal.current += 1;
          singing.current = event.singing;
          break;
        case "lyric":
          lyricLine.current.push(event.text);
          if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
          setBubble({ text: lyricLine.current.join(" "), kind: "song" });
          break;
        case "phrase-break":
          lyricLine.current = [];
          break;
        case "song-start":
          playingMusic.current = true;
          setNowPlaying(event.song.title);
          lyricLine.current = [];
          say(
            SONG_INTRO_LINES[
              Math.floor(Math.random() * SONG_INTRO_LINES.length)
            ],
            "speech"
          );
          break;
        case "song-end":
          playingMusic.current = false;
          setNowPlaying(null);
          singing.current = false;
          lyricLine.current = [];
          setBubble(null);
          break;
      }
    });
    return off;
  }, [performance, say]);

  useEffect(() => {
    return () => {
      if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
      if (captionTimer.current) clearTimeout(captionTimer.current);
      performance.dispose();
    };
  }, [performance]);

  useEffect(() => {
    const text = nowPlayingTextRef.current;
    const viewport = nowPlayingViewportRef.current;
    const chip = nowPlayingChipRef.current;
    const slot = nowPlayingSlotRef.current;
    if (!nowPlaying || !text || !viewport || !chip || !slot) {
      setNowPlayingOverflows(false);
      return;
    }
    const measure = () => {
      // Compare natural title width to room left in the footer slot
      // (chip grows with content; slot is the real ceiling).
      const styles = getComputedStyle(chip);
      const padX =
        (parseFloat(styles.paddingLeft) || 0) +
        (parseFloat(styles.paddingRight) || 0);
      const gap = parseFloat(styles.gap) || 0;
      const icon = chip.querySelector(".bard-now-playing-icon");
      const iconW = icon instanceof HTMLElement ? icon.offsetWidth : 0;
      const available = Math.max(0, slot.clientWidth - padX - gap - iconW);
      const textW = text.scrollWidth;
      const overflow = textW > available + 2;
      setNowPlayingOverflows(overflow);
      if (overflow) {
        const viewportW = Math.max(1, available);
        text.style.setProperty(
          "--bard-scroll",
          `${Math.max(0, textW - viewportW)}px`,
        );
      } else {
        text.style.removeProperty("--bard-scroll");
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(slot);
    return () => observer.disconnect();
  }, [nowPlaying]);

  const stageRef = useRef<HTMLDivElement>(null);
  const [immersive, setImmersive] = useState(false);
  const [uiHidden, setUiHidden] = useState(false);

  const exitImmersive = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch {
      // Ignore — CSS fallback still clears below.
    }
    setImmersive(false);
    setUiHidden(false);
  }, []);

  const enterImmersive = useCallback(async () => {
    const el = stageRef.current;
    if (!el) return;
    setImmersive(true);
    try {
      if (el.requestFullscreen) {
        await el.requestFullscreen();
      }
    } catch {
      // iOS / blocked FS — CSS fixed overlay still covers the viewport.
    }
  }, []);

  const toggleImmersive = useCallback(() => {
    if (immersive) void exitImmersive();
    else void enterImmersive();
  }, [immersive, enterImmersive, exitImmersive]);

  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setImmersive(false);
        setUiHidden(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!stageRef.current) return;
      // Esc restores chrome and leaves full screen together.
      if (uiHidden) setUiHidden(false);
      if (stageRef.current.classList.contains("is-immersive")) {
        void exitImmersive();
      }
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [exitImmersive, uiHidden]);

  const getBardPosition = useCallback(() => {
    const bard = bardRef.current;
    if (!bard) return null;
    return { x: bard.position.x, z: bard.position.z };
  }, []);

  const toggleAudio = useCallback(async () => {
    if (audioOn) {
      // Silencing him is a direct consequence of the click, so it happens
      // here rather than in an effect watching `audioOn` — an effect would
      // schedule a second render pass to do work the event already knows about.
      audioOnRef.current = false;
      singing.current = false;
      playingMusic.current = false;
      setAudioOn(false);
      setNowPlaying(null);
      // Long fade — song-end from stop() also clears performance listeners.
      performance.stop(1.6);
      return;
    }
    // Must happen inside the click for the browser to unlock the context.
    await performance.resume();
    walkAmbience.unlock();
    audioOnRef.current = true;
    setAudioOn(true);
    void performance.play();
  }, [audioOn, performance]);

  const handleActivityChange = useCallback((next: Activity) => {
    if (next === "travelling") setCaption("Punaab is on the road.");
  }, []);

  return (
    <div
      ref={stageRef}
      className={`bard-world${immersive ? " is-immersive" : ""}`}
      onPointerDown={() => walkAmbience.unlock()}
    >
      {bootScene && (
        <Canvas
          shadows
          dpr={budget.dpr}
          camera={{ position: [8, 6, 14], fov: 46, near: 0.3, far: 620 }}
          gl={{
            antialias: !budget.postprocessing,
            alpha: false,
            powerPreference: "high-performance",
          }}
          onCreated={({ gl, scene }) => {
            // ACES is the standard film response curve; it rolls off highlights
            // instead of clipping them, which is most of why a render reads as
            // photographic rather than as a screenshot of a game engine.
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.18;
            gl.shadowMap.type = THREE.PCFSoftShadowMap;
            // Match the stage frame so a brief loader gap never flashes black.
            gl.setClearColor("#4aa3e8", 1);
            scene.background = null;
          }}
        >
          <Suspense fallback={null}>
            <Scene
              budget={budget}
              director={director}
              bardRef={bardRef}
              headAnchorRef={headAnchorRef}
              pluckSignal={pluckSignal}
              singing={singing}
              playingMusic={playingMusic}
              activity={activity}
              bubble={uiHidden ? null : bubble}
              onActivityChange={handleActivityChange}
              sampleMusic={sampleMusic}
              enrichWorld={enrichWorld}
              onCoreReady={handleSceneReady}
            />
          </Suspense>
        </Canvas>
      )}

      {showLoader && (
        <ValleyLoader
          ready={sceneReady}
          fading={loaderFading}
          onFinished={handleLoaderFinished}
        />
      )}

      {!showLoader && !uiHidden && (
        <>
          <div className="bard-world-caption">{caption}</div>
          <div className="bard-world-chrome">
            <button
              type="button"
              className="bard-map-open"
              onClick={(event) => {
                event.stopPropagation();
                setMapOpen(true);
              }}
              aria-label="Open the map of PIXELGREW"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18">
                <path
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinejoin="round"
                  d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14"
                />
              </svg>
              <span>Map</span>
            </button>
            <button
              type="button"
              className="bard-ui-toggle"
              onClick={(event) => {
                event.stopPropagation();
                setUiHidden(true);
              }}
              aria-label="Hide UI"
              title="Hide UI"
            >
              Hide UI
            </button>
            <button
              type="button"
              className={`bard-fs-toggle${immersive ? " is-exit" : ""}`}
              onClick={(event) => {
                event.stopPropagation();
                toggleImmersive();
              }}
              aria-pressed={immersive}
              aria-label={immersive ? "Exit full screen" : "Full screen"}
              title={immersive ? "Exit full screen (Esc)" : "Full screen"}
            >
              {immersive ? (
                <>
                  <svg
                    className="bard-fs-icon"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path
                      fill="currentColor"
                      d="M9 3H5v4h2V5h2V3zm10 0h-4v2h2v2h2V3zM7 15H5v4h4v-2H7v-2zm12 0h-2v2h-2v2h4v-4z"
                    />
                  </svg>
                  <span>Exit</span>
                </>
              ) : (
                <svg
                  className="bard-fs-icon"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path
                    fill="currentColor"
                    d="M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zM4 14h2v4h4v2H4v-6zm14 0h2v6h-6v-2h4v-4z"
                  />
                </svg>
              )}
            </button>
          </div>

          <div className="bard-world-dock">
            <div className="bard-world-footer">
              <div ref={nowPlayingSlotRef} className="bard-world-hint-slot">
                {nowPlaying ? (
                  <div
                    ref={nowPlayingChipRef}
                    className={`bard-now-playing${nowPlayingOverflows ? " is-marquee" : ""}`}
                    title={nowPlaying}
                  >
                    <span className="bard-now-playing-icon" aria-hidden="true">
                      ♪
                    </span>
                    <div
                      ref={nowPlayingViewportRef}
                      className="bard-now-playing-viewport"
                    >
                      <span
                        ref={nowPlayingTextRef}
                        className={`bard-now-playing-text${
                          nowPlayingOverflows ? " is-scrolling" : ""
                        }`}
                      >
                        {nowPlaying}
                      </span>
                    </div>
                  </div>
                ) : immersive ? (
                  <div className="bard-world-hint">Esc or Exit to leave</div>
                ) : null}
              </div>
              <div className="bard-world-footer-actions">
                {immersive && (
                  <button
                    type="button"
                    className="bard-fs-toggle is-exit bard-fs-toggle-dock"
                    onClick={(event) => {
                      event.stopPropagation();
                      void exitImmersive();
                    }}
                  >
                    Exit full screen
                  </button>
                )}
                <button
                  type="button"
                  className={`bard-sound-toggle${audioOn ? " is-on" : ""}`}
                  onClick={toggleAudio}
                  aria-pressed={audioOn}
                >
                  <svg
                    className="bard-sound-icon"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path
                      fill="currentColor"
                      d="M4 9v6h3.5L14 20V4L7.5 9H4zm11.5 1.1a3.2 3.2 0 0 1 0 3.8l-1.2-1.1a1.6 1.6 0 0 0 0-1.6l1.2-1.1zm2.3-2.6a6.5 6.5 0 0 1 0 8.9l-1.2-1.2a4.8 4.8 0 0 0 0-6.5l1.2-1.2z"
                    />
                  </svg>
                  {audioOn ? "Stop song" : "PLAY A SONG"}
                </button>
              </div>
            </div>
          </div>

          <WorldMap
            open={mapOpen}
            onClose={() => setMapOpen(false)}
            currentPlaceId={currentPlaceId}
            getBardPosition={getBardPosition}
            onTravel={(placeId) => {
              const dispatched = director.travelTo(placeId);
              if (dispatched) {
                // Say where he is headed straight away. The walk itself can be
                // minutes long, so without this the map closes and apparently
                // nothing happens.
                const place = findPlace(placeId);
                if (place) setCaption(`Punaab sets out for ${place.name}.`);
              }
              return dispatched;
            }}
          />
        </>
      )}
    </div>
  );
}

function captionFor(stop: Stop): string {
  switch (stop.activity) {
    case "trading":
      return `Punaab is trading at ${stop.name}.`;
    case "talking":
      return `Punaab is talking with folks at ${stop.name}.`;
    case "resting":
      return `Punaab is resting at ${stop.name}.`;
    case "performing":
      return `Punaab is playing at ${stop.name}.`;
    case "discovering":
      return `Punaab discovered ${stop.name}.`;
    case "wondering":
      return `Punaab is taking in ${stop.name}.`;
    default:
      return `Punaab stopped at ${stop.name}.`;
  }
}
