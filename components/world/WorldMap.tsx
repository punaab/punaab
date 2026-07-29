"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MAP_PLACES,
  WORLD_NAME,
  bakeMap,
  mapToWorld,
  worldToMap,
  type MapPlace,
} from "@/lib/world/cartography";

/**
 * The map of PIXELGREW.
 *
 * The parchment itself is baked once to a canvas and used as an image — it is
 * static, because the world is. The pins on top are real DOM buttons rather
 * than more canvas drawing, which costs a little layout and buys everything
 * else: hover, keyboard focus, screen readers, and the browser's own hit
 * testing instead of a hand-rolled one.
 */

const MAP_TEXTURE_SIZE = 1400;

const KIND_LABEL: Record<MapPlace["kind"], string> = {
  town: "Town",
  village: "Village",
  hamlet: "Hamlet",
  port: "Port",
  holy: "Priory",
  industry: "Delve",
  camp: "Camp",
  ruin: "Ruin",
  landmark: "Landmark",
};

/**
 * Pin glyphs, drawn as inline SVG paths.
 *
 * A map reader identifies a settlement by its *symbol* long before reading its
 * name, so a town and a ruin must not be the same dot at different sizes.
 */
function PlaceGlyph({ kind }: { kind: MapPlace["kind"] }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (kind) {
    case "town":
      return (
        <g {...common}>
          <path d="M-5 4 h10 M-4 4 V-1 l4-3 4 3 v5" />
          <path d="M-1.4 4 V1 h2.8 v3" />
          <path d="M4 -1 v-3" />
        </g>
      );
    case "village":
    case "hamlet":
      return (
        <g {...common}>
          <path d="M-4 4 h8 M-3 4 V0 l3-2.6 3 2.6 v4" />
        </g>
      );
    case "port":
      return (
        <g {...common}>
          <path d="M0 -4 v8 M-3.4 -1.6 h6.8 M-3.6 2.2 a3.6 3.6 0 0 0 7.2 0" />
        </g>
      );
    case "holy":
      return (
        <g {...common}>
          <path d="M0 -5 v9 M-2.4 -2.2 h4.8" />
        </g>
      );
    case "industry":
      return (
        <g {...common}>
          <path d="M-4 4 h8 M-2.6 4 V-1 M2.6 4 V-1 M-4 -1 l4-3 4 3" />
        </g>
      );
    case "camp":
      return (
        <g {...common}>
          <path d="M-4 4 L0 -4 L4 4 Z" />
        </g>
      );
    case "ruin":
      return (
        <g {...common}>
          <path d="M-4 4 V-1 l2-2 v2 h2 v-3 l2 2 v6" />
        </g>
      );
    default:
      return (
        <g {...common}>
          <circle cx="0" cy="0" r="2.4" />
          <path d="M0 -4.6 v1.4 M0 3.2 v1.4 M-4.6 0 h1.4 M3.2 0 h1.4" />
        </g>
      );
  }
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;

/**
 * What is drawn at what magnification.
 *
 * A real chart does not print every hamlet at every scale, and neither should
 * this: sixty-one marks on a fully zoomed-out map is a rash, and the settlements
 * — the things you actually navigate by — get lost among them. So the towns are
 * always there, the lone landmarks appear once you have zoomed in enough for
 * there to be room, and their names follow one step later.
 *
 * Pins stay in the DOM throughout and are hidden with a class. Mounting and
 * unmounting fifty buttons on every zoom step would thrash layout during a
 * gesture, and it would also drop focus if a keyboard user had one selected.
 */
const LANDMARK_ZOOM = 1.6;
/** World metres — parchment clicks this close to a mark count as that place. */
const PLACE_SNAP_METRES = 22;
/** Names appear a little sooner so zooming in always finds readable labels. */
const LANDMARK_LABEL_ZOOM = 1.85;

/**
 * How hard pins counter the canvas zoom.
 *
 * Full `1/zoom` keeps marks screen-constant but CSS-scales text down to a
 * few device pixels before the parent zooms it back up — soft, unreadable
 * type at high magnification. Square-root easing lets marks grow gently as
 * you zoom in so names stay sharp and legible.
 */
function pinCounterScale(zoom: number) {
  return 1 / Math.sqrt(Math.max(1, zoom));
}

export function WorldMap({
  open,
  onClose,
  onTravel,
  onTravelPoint,
  currentPlaceId,
  /** Highlight a chosen pin (inline /places chart, or sticky read-out). */
  selectedPlaceId,
  /** Live world metres — when set, a Punaab token tracks him on the chart. */
  getBardPosition,
  /** Fills its container instead of sitting in a modal. Used by /world. */
  inline = false,
  /** Called when a pin is chosen in inline mode, instead of travelling. */
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  /** Dispatch the bard. Returns false if the place is unreachable. */
  onTravel: (placeId: string) => boolean;
  /**
   * Bare-parchment click (travel map only). World metres. Returns false if the
   * spot cannot be stood on.
   */
  onTravelPoint?: (x: number, z: number) => boolean;
  currentPlaceId?: string | null;
  selectedPlaceId?: string | null;
  getBardPosition?: () => { x: number; z: number } | null;
  inline?: boolean;
  onSelect?: (place: MapPlace) => void;
}) {
  const [texture, setTexture] = useState<string | null>(null);
  const [hovered, setHovered] = useState<MapPlace | null>(null);
  const [picked, setPicked] = useState<MapPlace | null>(null);
  const [travelling, setTravelling] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const bardMarkerRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const getBardPositionRef = useRef(getBardPosition);
  getBardPositionRef.current = getBardPosition;

  // --- Zoom and pan -------------------------------------------------------
  //
  // Held in a ref and written straight to the transform rather than to state.
  // A wheel gesture fires dozens of events a second and a drag fires one per
  // mouse move; routing either through React would re-render sixty-one pins on
  // every one of them.
  const viewRef = useRef({ zoom: 1, x: 0, y: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const [zoomLabel, setZoomLabel] = useState(1);

  const applyView = useCallback(() => {
    const el = canvasRef.current;
    if (!el) return;
    const { zoom, x, y } = viewRef.current;
    el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${zoom})`;
  }, []);

  /**
   * Keeps the chart from being dragged off its own frame.
   *
   * The slack has to be measured against the CANVAS, not the stage. The canvas
   * is a square contained inside a frame that is usually wider than it is tall,
   * so the two differ — in a 900x500 stage the canvas is 500x500, and at 2x
   * there are only 50px of real horizontal overflow, not the 450 the stage's
   * own width implies. Clamping to the stage let the drag run four hundred
   * pixels into empty paper and then stop dead, which is what "dragging does
   * nothing" actually looks like.
   */
  const clampPan = useCallback(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;
    const { zoom } = viewRef.current;

    // `clientWidth` is the un-transformed layout size; the transform scales it.
    const scaledWidth = canvas.clientWidth * zoom;
    const scaledHeight = canvas.clientHeight * zoom;

    // Only whatever hangs outside the frame is draggable. Never negative: a
    // chart smaller than its frame stays centred.
    const slackX = Math.max(0, (scaledWidth - stage.clientWidth) / 2);
    const slackY = Math.max(0, (scaledHeight - stage.clientHeight) / 2);

    viewRef.current.x = Math.max(-slackX, Math.min(slackX, viewRef.current.x));
    viewRef.current.y = Math.max(-slackY, Math.min(slackY, viewRef.current.y));
  }, []);

  /** Zooms about a point in stage coordinates, so the map grows under the cursor. */
  const zoomAt = useCallback(
    (factor: number, originX?: number, originY?: number) => {
      const stage = stageRef.current;
      if (!stage) return;
      const view = viewRef.current;
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.zoom * factor));
      if (next === view.zoom) return;

      const cx = originX ?? stage.clientWidth / 2;
      const cy = originY ?? stage.clientHeight / 2;
      // Offset from centre, since the transform origin is the middle.
      const dx = cx - stage.clientWidth / 2;
      const dy = cy - stage.clientHeight / 2;
      const ratio = next / view.zoom;
      view.x = dx - (dx - view.x) * ratio;
      view.y = dy - (dy - view.y) * ratio;
      view.zoom = next;

      clampPan();
      applyView();
      setZoomLabel(next);
    },
    [applyView, clampPan]
  );

  const resetView = useCallback(() => {
    viewRef.current = { zoom: 1, x: 0, y: 0 };
    applyView();
    setZoomLabel(1);
  }, [applyView]);

  // Wheel to zoom. Non-passive so the page behind never scrolls under it.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !open) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      zoomAt(
        event.deltaY < 0 ? 1.16 : 1 / 1.16,
        event.clientX - rect.left,
        event.clientY - rect.top
      );
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [open, zoomAt, texture]);

  // Bake lazily, and only once the map is first opened — the parchment costs a
  // relief sample of the whole world and most visitors never open it.
  useEffect(() => {
    if (!open || texture) return;
    let cancelled = false;
    // Off the click's own frame, so opening the map is never a janky button.
    const handle = requestAnimationFrame(() => {
      const canvas = bakeMap(MAP_TEXTURE_SIZE);
      if (!cancelled) setTexture(canvas.toDataURL("image/png"));
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(handle);
    };
  }, [open, texture]);

  // Live Punaab token + screen-space labels. Labels sit OUTSIDE the zoomed
  // canvas so type is never CSS-scaled into mush at high magnification; their
  // positions are projected from the transformed paper each frame.
  const trackBard = Boolean(getBardPosition);
  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const tick = () => {
      const stage = stageRef.current;
      const canvas = canvasRef.current;
      const labels = labelsRef.current;
      const scale = pinCounterScale(viewRef.current.zoom);
      const pos = trackBard ? getBardPositionRef.current?.() ?? null : null;

      if (stage && canvas && labels) {
        const sr = stage.getBoundingClientRect();
        const cr = canvas.getBoundingClientRect();
        const project = (leftPct: number, topPct: number, nest = 14 * scale) => {
          const x = cr.left + (leftPct / 100) * cr.width - sr.left;
          const y = cr.top + (topPct / 100) * cr.height - sr.top;
          return `translate(${x}px, ${y + nest}px) translate(-50%, 0)`;
        };

        for (const el of labels.querySelectorAll<HTMLElement>(".pg-map-label")) {
          if (el.classList.contains("pg-map-label-bard")) continue;
          const left = Number(el.dataset.left);
          const top = Number(el.dataset.top);
          if (!Number.isFinite(left) || !Number.isFinite(top)) continue;
          el.style.transform = project(left, top);
        }

        const bardLabel = labels.querySelector<HTMLElement>(".pg-map-label-bard");
        if (bardLabel) {
          if (pos) {
            const [left, top] = worldToMap(pos.x, pos.z, 100);
            bardLabel.style.transform = project(left, top, 16 * scale);
            bardLabel.hidden = false;
          } else {
            bardLabel.hidden = true;
          }
        }
      }

      const bardEl = bardMarkerRef.current;
      if (bardEl) {
        if (pos) {
          const [left, top] = worldToMap(pos.x, pos.z, 100);
          bardEl.style.left = `${left}%`;
          bardEl.style.top = `${top}%`;
          bardEl.style.setProperty("--pg-pin-scale", String(scale));
          bardEl.hidden = false;
        } else {
          bardEl.hidden = true;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [open, trackBard]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Focus the panel so Escape and tabbing work without a click first.
    dialogRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const places = useMemo(
    () =>
      MAP_PLACES.map((place) => {
        const [x, y] = worldToMap(place.x, place.z, 100);
        return { place, left: x, top: y };
      }),
    []
  );

  // Prefer an explicit selection from the parent (including cleared `null`),
  // then a local pick, then hover.
  const focused =
    selectedPlaceId !== undefined
      ? (MAP_PLACES.find((p) => p.id === selectedPlaceId) ?? null) || hovered
      : picked || hovered;

  const handleTravel = useCallback(
    (place: MapPlace) => {
      // A pin click that ended a drag is a pan, not a choice.
      if (dragRef.current?.moved) return;
      setPicked(place);
      if (onSelect) {
        onSelect(place);
        return;
      }
      if (!onTravel(place.id)) return;
      setTravelling(place.id);
      // Hold the map up briefly so the choice registers, then dissolve back to
      // the valley. Closing instantly reads as the click having failed.
      window.setTimeout(() => {
        setTravelling(null);
        onClose();
      }, 620);
    },
    [onTravel, onClose, onSelect]
  );

  /**
   * Bare parchment → send him there (or snap onto a nearby named mark).
   * Pins handle themselves; this only fires on empty paper after a true click.
   */
  const handleGroundClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (inline || !onTravelPoint) return;
      if (dragRef.current?.moved) return;
      const target = event.target as HTMLElement;
      if (target.closest(".pg-pin")) return;
      if (target.closest(".pg-map-zoom")) return;
      if (target.closest(".pg-map-close")) return;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const u = (event.clientX - rect.left) / rect.width;
      const v = (event.clientY - rect.top) / rect.height;
      if (u < 0 || u > 1 || v < 0 || v > 1) return;

      const [x, z] = mapToWorld(u * 1000, v * 1000, 1000);

      // Prefer a named place if the click landed close to a mark.
      let nearest: MapPlace | null = null;
      let nearestDist = PLACE_SNAP_METRES;
      for (const place of MAP_PLACES) {
        const dist = Math.hypot(place.x - x, place.z - z);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = place;
        }
      }
      if (nearest) {
        handleTravel(nearest);
        return;
      }

      if (!onTravelPoint(x, z)) return;
      setPicked(null);
      setTravelling("point");
      window.setTimeout(() => {
        setTravelling(null);
        onClose();
      }, 620);
    },
    [inline, onTravelPoint, handleTravel, onClose]
  );

  // --- Drag to pan --------------------------------------------------------
  //
  // The move and up handlers go on `window`, not on the element.
  //
  // `setPointerCapture` is the tidier API and it is why this was unreliable:
  // it throws if the element is not connected, it is silently dropped when the
  // browser starts a native drag on a descendant, and any of that leaves the
  // gesture half-alive — you press, move, and nothing happens, but only
  // sometimes. Listening on the window for the duration of the gesture has
  // none of those failure modes and keeps panning even when the cursor leaves
  // the frame entirely, which is exactly what you want when dragging a map
  // toward something off its edge.
  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      // Stops the browser starting a native image/text drag or a selection,
      // which is the other half of why this felt like dragging a picture.
      event.preventDefault();

      dragRef.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        moved: false,
      };

      const onMove = (move: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag || drag.id !== move.pointerId) return;
        const dx = move.clientX - drag.x;
        const dy = move.clientY - drag.y;
        // A few pixels of slop, so a slightly shaky press on a pin still
        // counts as a click rather than a pan.
        if (!drag.moved && Math.hypot(dx, dy) < 4) return;
        drag.moved = true;
        drag.x = move.clientX;
        drag.y = move.clientY;
        viewRef.current.x += dx;
        viewRef.current.y += dy;
        clampPan();
        applyView();
      };

      const onUp = (up: PointerEvent) => {
        const drag = dragRef.current;
        if (drag && drag.id !== up.pointerId) return;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        // Cleared a frame later so a pin's click handler can still tell that
        // this gesture ended as a drag.
        requestAnimationFrame(() => {
          dragRef.current = null;
        });
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [applyView, clampPan]
  );

  if (!open) return null;

  // Inline: no scrim, no dialog semantics, no backdrop click — it is part of
  // the page rather than something covering it.
  const panel = (
    <div
      className={`pg-map-panel${inline ? " is-inline" : ""}`}
      ref={dialogRef}
      tabIndex={-1}
    >
        <header className="pg-map-head">
          <div>
            <h2 className="pg-map-title">
              <Image
                src="/assets/images/pixlegrew.webp"
                alt=""
                width={36}
                height={36}
                className="pg-map-title-logo"
                unoptimized
              />
              <span>{WORLD_NAME}</span>
            </h2>
            <p>
              {MAP_PLACES.length} places ·{" "}
              {inline
                ? "click a mark to open it · scroll to zoom, drag to pan"
                : "click anywhere to send Punaab · scroll to zoom, drag to pan"}
            </p>
          </div>
          {!inline && (
            <button type="button" className="pg-map-close" onClick={onClose}>
              Close
            </button>
          )}
        </header>

        <div
          className="pg-map-sheet"
          ref={stageRef}
          onPointerDown={onPointerDown}
          onClick={handleGroundClick}
          // Belt and braces against the browser's own drag-and-drop: even with
          // `draggable={false}` on the paper, a press that begins on a pin or
          // on a text node can still start a native drag, and once that begins
          // the pointer stream stops and the pan dies mid-gesture.
          onDragStart={(event) => event.preventDefault()}
        >
          {/* Everything that scales and pans lives inside one transformed
              layer, so zooming is a single composited transform rather than a
              re-layout of sixty-one absolutely positioned buttons. */}
          <div className="pg-map-canvas" ref={canvasRef}>
            {texture ? (
              <img src={texture} alt="" className="pg-map-paper" draggable={false} />
            ) : (
              <div className="pg-map-baking">Inking the chart…</div>
            )}

            <div className="pg-map-pins">
            {places.map(({ place, left, top }) => {
              const active = place.id === currentPlaceId;
              const going = place.id === travelling;
              const chosen =
                selectedPlaceId !== undefined
                  ? place.id === selectedPlaceId
                  : place.id === picked?.id;
              // Settlements are always on the chart; lone landmarks earn their
              // place as you zoom in. `is-here` overrides that — wherever the
              // bard is standing stays visible at every scale.
              const minor = place.weight < 1.5;
              const shown =
                !minor || active || chosen || zoomLabel >= LANDMARK_ZOOM;
              return (
                <button
                  key={place.id}
                  type="button"
                  className={
                    `pg-pin pg-pin-${place.kind}` +
                    (active ? " is-here" : "") +
                    (going ? " is-going" : "") +
                    (chosen ? " is-selected" : "") +
                    (shown ? "" : " is-faded")
                  }
                  aria-pressed={chosen || undefined}
                  aria-hidden={shown ? undefined : true}
                  tabIndex={shown ? undefined : -1}
                  style={{
                    left: `${left}%`,
                    top: `${top}%`,
                    ["--pg-pin-scale" as string]: String(
                      pinCounterScale(zoomLabel)
                    ),
                  }}
                  onClick={() => handleTravel(place)}
                  onMouseEnter={() => setHovered(place)}
                  onMouseLeave={() => setHovered((h) => (h === place ? null : h))}
                  onFocus={() => setHovered(place)}
                  onBlur={() => setHovered((h) => (h === place ? null : h))}
                  aria-label={`${place.name} — ${KIND_LABEL[place.kind]}${active ? ", Punaab is here" : ""}`}
                >
                  <svg viewBox="-8 -8 16 16" aria-hidden="true">
                    <PlaceGlyph kind={place.kind} />
                  </svg>
                </button>
              );
            })}
            {getBardPosition && (
              <div
                ref={bardMarkerRef}
                className="pg-bard-marker"
                hidden
                aria-label="Punaab the Traveler — live position"
              >
                <span className="pg-bard-marker-face">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/assets/pun.png" alt="" draggable={false} />
                </span>
              </div>
            )}
            </div>
          </div>

          {/* Screen-space names — not inside the zoom transform, so type stays
              crisp when the paper is magnified. */}
          <div className="pg-map-labels" ref={labelsRef} aria-hidden="true">
            {places.map(({ place, left, top }) => {
              const active = place.id === currentPlaceId;
              const chosen =
                selectedPlaceId !== undefined
                  ? place.id === selectedPlaceId
                  : place.id === picked?.id;
              const minor = place.weight < 1.5;
              const shown =
                !minor || active || chosen || zoomLabel >= LANDMARK_ZOOM;
              const named =
                !minor || chosen || zoomLabel >= LANDMARK_LABEL_ZOOM;
              if (!shown || !named) return null;
              return (
                <span
                  key={place.id}
                  className={
                    "pg-map-label" +
                    (active || chosen ? " is-hot" : "") +
                    (minor ? " is-minor" : "")
                  }
                  data-left={left}
                  data-top={top}
                >
                  {place.name}
                </span>
              );
            })}
            {getBardPosition && (
              <span className="pg-map-label pg-map-label-bard is-hot">
                Punaab
              </span>
            )}
          </div>

          <div className="pg-map-zoom">
            <button
              type="button"
              onClick={() => zoomAt(1.4)}
              aria-label="Zoom in"
              disabled={zoomLabel >= MAX_ZOOM}
            >
              +
            </button>
            <button
              type="button"
              onClick={() => zoomAt(1 / 1.4)}
              aria-label="Zoom out"
              disabled={zoomLabel <= MIN_ZOOM}
            >
              −
            </button>
            <button
              type="button"
              className="pg-map-zoom-reset"
              onClick={resetView}
              aria-label="Reset the view"
              disabled={zoomLabel === 1}
            >
              Fit
            </button>
          </div>
        </div>

        <footer className="pg-map-foot">
          {focused ? (
            <>
              <strong>{focused.name}</strong>
              <span className="pg-map-kind">{KIND_LABEL[focused.kind]}</span>
              {focused.blurb && (
                <span className="pg-map-blurb">{focused.blurb}</span>
              )}
            </>
          ) : (
            <span className="pg-map-hint">
              {inline
                ? "Click a mark to read it. Drag to pan, scroll to zoom."
                : "Click a mark or open ground to send Punaab. Esc closes."}
            </span>
          )}
        </footer>
    </div>
  );

  if (inline) return panel;

  return (
    <div
      className={`pg-map-scrim${travelling ? " is-leaving" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Map of ${WORLD_NAME}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {panel}
    </div>
  );
}
