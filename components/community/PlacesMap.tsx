"use client";

import { useCallback, useRef, useState } from "react";
import { WorldMap } from "@/components/world/WorldMap";
import {
  MAP_PLACES,
  locationKeyFor,
  mapToWorld,
  type MapPlace,
} from "@/lib/world/cartography";
import { regionAt } from "@/lib/world/regions";

/**
 * The big chart on `/world/places`.
 *
 * Two jobs, and they are deliberately different from the one the hero map has.
 * There, clicking a mark sends the bard walking. Here, the map is a *submission
 * surface*: clicking an existing place opens what has already been written
 * about it, and clicking bare ground proposes somewhere new.
 *
 * It reuses `WorldMap` in inline mode rather than drawing a second chart. A
 * separate implementation would be a second opinion about where everything is,
 * and the moment the two drifted, a place proposed here would land somewhere
 * else in the valley.
 */

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

export { locationKeyFor };

export function PlacesMap({
  onPropose,
  onOpenPlace,
}: {
  /** A spot on bare ground. Receives a location key and world coordinates. */
  onPropose?: (key: string, x: number, z: number) => void;
  /** An existing place was chosen. */
  onOpenPlace?: (place: MapPlace) => void;
}) {
  const [pending, setPending] = useState<{ key: string; x: number; z: number } | null>(
    null
  );
  const [selected, setSelected] = useState<MapPlace | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  // Pan / pinch should never count as "propose a place".
  const gestureRef = useRef({ x: 0, y: 0, moved: false });

  const handlePointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0) return;
    gestureRef.current = { x: event.clientX, y: event.clientY, moved: false };
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent) => {
    const g = gestureRef.current;
    if (g.moved) return;
    if (Math.hypot(event.clientX - g.x, event.clientY - g.y) > 6) {
      g.moved = true;
    }
  }, []);

  /**
   * Turns a tap on the parchment into world coordinates.
   *
   * Read off the transformed canvas rather than the frame, so it stays correct
   * at any zoom or pan — the canvas element *is* the map's coordinate space, so
   * its own bounding box already has the transform baked in.
   */
  const handleSheetClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (gestureRef.current.moved) return;
      // Clicks that landed on a pin are the pin's business.
      if ((event.target as HTMLElement).closest(".pg-pin")) return;
      if ((event.target as HTMLElement).closest(".pg-map-zoom")) return;
      const canvas = sheetRef.current?.querySelector(".pg-map-canvas");
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const u = (event.clientX - rect.left) / rect.width;
      const v = (event.clientY - rect.top) / rect.height;
      if (u < 0 || u > 1 || v < 0 || v > 1) return;

      const [x, z] = mapToWorld(u * 1000, v * 1000, 1000);
      const key = locationKeyFor(x, z);
      setSelected(null);
      setPending({ key, x, z });
      onPropose?.(key, x, z);
    },
    [onPropose]
  );

  const region = selected ? regionAt(selected.x, selected.z) : null;

  return (
    <div
      className="pg-places"
      ref={sheetRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onClick={handleSheetClick}
    >
      <WorldMap
        open
        inline
        onClose={() => {}}
        onTravel={() => false}
        selectedPlaceId={selected?.id ?? null}
        onSelect={(place) => {
          setPending(null);
          setSelected(place);
          onOpenPlace?.(place);
        }}
      />

      {selected && (
        <aside className="pg-place-info" aria-live="polite">
          <div className="pg-place-info-head">
            <h3>{selected.name}</h3>
            <span className="pg-map-kind">{KIND_LABEL[selected.kind]}</span>
          </div>
          {selected.blurb && <p className="pg-place-info-blurb">{selected.blurb}</p>}
          <dl className="pg-place-info-meta">
            {region && (
              <>
                <dt>Region</dt>
                <dd>
                  {region.name}
                  <span className="pg-place-info-biome"> · {region.biome}</span>
                </dd>
              </>
            )}
            <dt>Coordinates</dt>
            <dd>
              <code>
                {Math.round(selected.x)}, {Math.round(selected.z)}
              </code>
            </dd>
            <dt>Location key</dt>
            <dd>
              <code>{locationKeyFor(selected.x, selected.z)}</code>
            </dd>
          </dl>
          <button
            type="button"
            className="pg-places-clear"
            onClick={(event) => {
              event.stopPropagation();
              setSelected(null);
            }}
          >
            Clear
          </button>
        </aside>
      )}

      <div className="pg-places-note" role="status">
        {pending ? (
          <>
            <strong>New point of interest</strong>
            <code>{pending.key}</code>
            <span>
              {Math.round(pending.x)}, {Math.round(pending.z)} — describe it
              below and it goes to the review queue.
            </span>
            <button
              type="button"
              className="pg-places-clear"
              onClick={(event) => {
                event.stopPropagation();
                setPending(null);
              }}
            >
              Clear
            </button>
          </>
        ) : selected ? (
          <span>
            Selected <strong>{selected.name}</strong>. Tap open ground to
            propose somewhere new, or another mark to switch.
          </span>
        ) : (
          <span>
            {MAP_PLACES.length} known places. Tap a mark to read it, or open
            ground to propose a new one. Drag to pan, pinch to zoom.
          </span>
        )}
      </div>
    </div>
  );
}
