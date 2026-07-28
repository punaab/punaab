"use client";

import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

export type BubbleKind =
  | "speech"
  | "song"
  | "thought"
  | "lore"
  | "quest"
  | "trade";

/**
 * The speech bubble that floats over Punaab's head.
 *
 * It soft-follows an empty node parented in his skull: close enough that it
 * clearly belongs to him, damped enough that the walk bob and head lean don't
 * shake the parchment. Fade-in / linger / fade-out are owned here so clearing
 * the line from React doesn't yank the plaque off mid-sentence.
 */

/** Extra world lift so the parchment clears the hood at close camera range. */
const HEAD_CLEARANCE = 0.22;

/**
 * How hard the plaque chases the skull, in "fraction closed per second".
 * Vertical is softer so hip bob doesn't bounce the text.
 */
const FOLLOW_XZ = 7;
const FOLLOW_Y = 3.2;

/** Fade-out hold before the DOM node is removed. Keep in sync with CSS. */
const FADE_OUT_MS = 520;

/** Camera range, in metres, at which the plaque renders at its CSS size. */
const SCALE_REFERENCE = 8.4;
const MIN_SCALE = 0.7;
const MAX_SCALE = 1.55;
/** Below this canvas width a full-size plaque eats the frame. */
const NARROW_CANVAS = 560;
const NARROW_MAX_SCALE = 1.08;
/** Share of the canvas width the bubble may span once scaled. */
const WIDTH_SHARE = 0.66;
const MIN_ROOM = 132;
/** Past this many characters the bubble widens rather than growing a column. */
const LONG_TEXT = 118;

type CssVars = React.CSSProperties & Record<`--${string}`, string>;

type TailShape = "point" | "streamer" | "puffs";
type SigilName = "note" | "star" | "pennant" | "coin";

type KindPreset = {
  tail: TailShape;
  /** Rubric above the line, manuscript style. Speech and thought carry none. */
  rubric?: string;
  sigil?: SigilName;
};

const KINDS: Record<BubbleKind, KindPreset> = {
  speech: { tail: "point" },
  song: { tail: "streamer", rubric: "Song", sigil: "note" },
  thought: { tail: "puffs" },
  lore: { tail: "point", rubric: "Discovery", sigil: "star" },
  quest: { tail: "point", rubric: "A Task", sigil: "pennant" },
  trade: { tail: "point", rubric: "Trade", sigil: "coin" },
};

const TAILS: Record<
  TailShape,
  { width: number; height: number; drop: number }
> = {
  point: { width: 36, height: 30, drop: 30 },
  streamer: { width: 36, height: 34, drop: 34 },
  puffs: { width: 36, height: 32, drop: 34 },
};

const TAIL_PATHS: Record<"point" | "streamer", string> = {
  point: "M6 0C6 9.4 9.6 16.8 18 24C23.4 16.6 26.6 8.6 28 0",
  streamer:
    "M8 0C7.6 9 11.8 13.6 13 19.6C13.6 23 15.6 26 18 28.8C19.4 22.6 20.6 16.6 22.2 10.6C23 7 23.6 3.4 24 0",
};

const THOUGHT_PUFFS = [
  { cx: 17, cy: 5.6, r: 5 },
  { cx: 20.4, cy: 15, r: 3.2 },
  { cx: 18, cy: 23.4, r: 2 },
];

function Tail({ shape }: { shape: TailShape }) {
  const { width, height } = TAILS[shape];
  const svg: React.SVGProps<SVGSVGElement> = {
    className: "bard-bubble-tail",
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    "aria-hidden": true,
    focusable: "false",
  };

  if (shape === "puffs") {
    return (
      <svg {...svg}>
        {THOUGHT_PUFFS.map((puff) => (
          <circle
            key={`shade-${puff.cy}`}
            className="bard-bubble-tail-shade"
            cx={puff.cx + 3}
            cy={puff.cy + 3}
            r={puff.r}
          />
        ))}
        {THOUGHT_PUFFS.map((puff) => (
          <circle
            key={`puff-${puff.cy}`}
            className="bard-bubble-tail-puff"
            cx={puff.cx}
            cy={puff.cy}
            r={puff.r}
          />
        ))}
      </svg>
    );
  }

  const d = TAIL_PATHS[shape];
  return (
    <svg {...svg}>
      <path
        className="bard-bubble-tail-shade"
        d={`${d}Z`}
        transform="translate(3 3)"
      />
      <path className="bard-bubble-tail-fill" d={`${d}Z`} />
      <path className="bard-bubble-tail-line" d={d} />
    </svg>
  );
}

function Sigil({ name, className }: { name: SigilName; className: string }) {
  const svg: React.SVGProps<SVGSVGElement> = {
    className,
    viewBox: "0 0 16 16",
    "aria-hidden": true,
    focusable: "false",
  };

  switch (name) {
    case "note":
      return (
        <svg {...svg}>
          <path
            d="M6.6 12.6V2.4l7-1.8v3.2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <ellipse
            cx="3.9"
            cy="12.4"
            rx="3.3"
            ry="2.6"
            transform="rotate(-20 3.9 12.4)"
          />
        </svg>
      );
    case "star":
      return (
        <svg {...svg}>
          <path d="M8 .6 9.5 6.5 15.4 8 9.5 9.5 8 15.4 6.5 9.5.6 8 6.5 6.5Z" />
        </svg>
      );
    case "pennant":
      return (
        <svg {...svg}>
          <path
            d="M4 1.2v13.6M4 1.6h9.6l-2.4 3 2.4 3H4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "coin":
      return (
        <svg {...svg}>
          <circle
            cx="8"
            cy="8"
            r="6.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <circle cx="8" cy="8" r="2.4" />
        </svg>
      );
  }
}

type BubblePayload = { text: string; kind: BubbleKind };

export function SpeechBubble({
  anchor,
  text,
  kind = "speech",
}: {
  anchor: React.RefObject<THREE.Object3D | null>;
  text: string | null;
  kind?: BubbleKind;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(1);
  const roomRef = useRef(0);
  const target = useMemo(() => new THREE.Vector3(), []);
  const smoothed = useMemo(() => new THREE.Vector3(), []);
  const hasPose = useRef(false);

  const [payload, setPayload] = useState<BubblePayload | null>(null);
  const [exiting, setExiting] = useState(false);
  const [enterId, setEnterId] = useState(0);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showingRef = useRef(false);

  // Keep the plaque mounted through fade-out so clearing `text` doesn't yank it.
  //
  // Arriving text is handled *during render* rather than in an effect. This is
  // React's sanctioned "adjust state when a prop changes" pattern, and it is
  // the right one here: an effect would paint one frame of the old line before
  // correcting itself, which on a bubble that changes every few seconds is a
  // visible flicker of the previous thing he said.
  const [seenText, setSeenText] = useState(text);
  if (text !== seenText) {
    setSeenText(text);
    if (text) {
      if (exitTimer.current) {
        clearTimeout(exitTimer.current);
        exitTimer.current = null;
      }
      if (!showingRef.current) setEnterId((id) => id + 1);
      showingRef.current = true;
      setPayload({ text, kind });
      setExiting(false);
    }
  }

  // Only the *departure* needs an effect, because it is genuinely a timer:
  // the plaque stays mounted and fades before it is torn down.
  useEffect(() => {
    if (text || !showingRef.current || exitTimer.current) return;

    setExiting(true);
    exitTimer.current = setTimeout(() => {
      showingRef.current = false;
      setPayload(null);
      setExiting(false);
      exitTimer.current = null;
    }, FADE_OUT_MS);
  }, [text]);

  useEffect(() => {
    return () => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
    };
  }, []);

  useFrame(({ camera, size }, delta) => {
    const group = groupRef.current;
    const node = anchor.current;
    if (!group || !node) return;

    node.getWorldPosition(target);
    target.y += HEAD_CLEARANCE;

    const dt = Math.min(delta, 0.05);
    if (!hasPose.current) {
      smoothed.copy(target);
      hasPose.current = true;
    } else {
      const tx = 1 - Math.exp(-FOLLOW_XZ * dt);
      const ty = 1 - Math.exp(-FOLLOW_Y * dt);
      smoothed.x += (target.x - smoothed.x) * tx;
      smoothed.z += (target.z - smoothed.z) * tx;
      smoothed.y += (target.y - smoothed.y) * ty;
    }
    group.position.copy(smoothed);

    const element = anchorRef.current;
    if (!element || !payload) return;

    const distance = Math.max(0.5, camera.position.distanceTo(smoothed));
    const ceiling = size.width < NARROW_CANVAS ? NARROW_MAX_SCALE : MAX_SCALE;
    const scale = Math.min(
      ceiling,
      Math.max(MIN_SCALE, SCALE_REFERENCE / distance)
    );
    const room = Math.max(MIN_ROOM, (size.width * WIDTH_SHARE) / scale);

    if (Math.abs(scale - scaleRef.current) > 0.004) {
      scaleRef.current = scale;
      element.style.setProperty("--bard-bubble-scale", scale.toFixed(3));
    }
    if (Math.abs(room - roomRef.current) > 1) {
      roomRef.current = room;
      element.style.setProperty("--bard-bubble-room", `${Math.round(room)}px`);
    }
  });

  if (!payload) {
    return <group ref={groupRef} />;
  }

  const preset = KINDS[payload.kind];
  const tail = TAILS[preset.tail];
  const long = payload.text.length > LONG_TEXT;

  const anchorStyle: CssVars = {
    "--bard-bubble-drop": `${tail.drop}px`,
    "--bard-bubble-tier": long ? "26rem" : "20rem",
    "--bard-bubble-scale": scaleRef.current.toFixed(3),
  };

  return (
    <group ref={groupRef}>
      <Html
        zIndexRange={[30, 10]}
        style={{ pointerEvents: "none" }}
      >
        <div
          ref={anchorRef}
          className="bard-bubble-anchor"
          style={anchorStyle}
        >
          <div
            key={enterId}
            className={`bard-bubble bard-bubble--${payload.kind}${
              long ? " bard-bubble--long" : ""
            }${exiting ? " is-exiting" : ""}`}
          >
            {preset.rubric && (
              <span className="bard-bubble-rubric">
                {preset.sigil && (
                  <Sigil name={preset.sigil} className="bard-bubble-sigil" />
                )}
                {preset.rubric}
              </span>
            )}
            <p className="bard-bubble-text">{payload.text}</p>
            {payload.kind === "song" && (
              <span className="bard-bubble-flits" aria-hidden="true">
                <Sigil name="note" className="bard-bubble-flit" />
                <Sigil name="note" className="bard-bubble-flit" />
              </span>
            )}
            <Tail shape={preset.tail} />
          </div>
        </div>
      </Html>
    </group>
  );
}

export function bubbleKindFor(activity: string): BubbleKind {
  switch (activity) {
    case "wondering":
      return "thought";
    case "discovering":
      return "lore";
    case "trading":
      return "trade";
    default:
      return "speech";
  }
}
