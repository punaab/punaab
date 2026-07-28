/**
 * The shape of a bridge deck.
 *
 * This exists as its own module for the same reason the terrain LOD plan does:
 * two different things need to know where the deck is — the geometry that draws
 * it and the footing that walks on it — and if they each work it out for
 * themselves they will disagree, which is a bard hovering above a bridge or
 * sunk into one.
 *
 * ## Why an arch
 *
 * The deck used to be flat, levelled to the road height at the bridge's own
 * centre. Measured against the real world that leaves two faults:
 *
 *   - the approach road at the *ends* differs from the centre by up to 0.64 m,
 *     so stepping onto the bridge is a jump — and because the footing code
 *     snaps rather than eases onto decks (easing through a multi-metre rise
 *     would look like walking through the structure), that jump is a visible
 *     glitch;
 *   - the bank at the ends stands as much as 1.92 m *above* the flat deck, so
 *     the ground swallows the bridge.
 *
 * An arch fixes both by construction. Pin the ends to whatever the approach
 * actually is — road or bank, whichever is higher — and raise the middle to
 * clear the channel. The ends then match the road exactly (no step, nothing to
 * snap), and the crown is above the ground it spans (nothing buried).
 */

import { heightAt, roadHeight, WATER_LEVEL } from "./terrain";
import type { Structure } from "./settlements";

/** Deck length along the span, in local units, before scale. */
export const BRIDGE_DECK_LENGTH = 13.4;

/** Headroom the crown keeps over the water it crosses. */
const CLEARANCE = 1.6;

/** Minimum camber, so even a bridge over flat ground reads as a bridge. */
const MIN_RISE = 0.55;

export type BridgeProfile = {
  /** World height of the deck at the two ends, local -Z then +Z. */
  endA: number;
  endB: number;
  /** Extra height at the crown, above the straight line between the ends. */
  rise: number;
  /** Half the deck length in world units. */
  half: number;
};

const cache = new Map<string, BridgeProfile>();

/** Where the deck's two ends have to meet, and how high the crown sits. */
export function bridgeProfile(s: Structure): BridgeProfile {
  const hit = cache.get(s.id);
  if (hit) return hit;

  const half = (BRIDGE_DECK_LENGTH / 2) * s.scale;
  const cos = Math.cos(s.rotation);
  const sin = Math.sin(s.rotation);

  // Local +Z runs along the span, which in three's Y-rotation convention maps
  // to world (sin, cos) — the same mapping `surfaces.ts` uses for deck tests.
  const endPoint = (k: -1 | 1) => ({
    x: s.x + k * half * sin,
    z: s.z + k * half * cos,
  });

  // Meet the HIGHER of the carriageway and the bank. Meeting the road alone
  // leaves the deck buried wherever the bank stands proud of it, which is the
  // failure this is here to fix.
  const heightAtEnd = (k: -1 | 1) => {
    const p = endPoint(k);
    return Math.max(roadHeight(p.x, p.z), heightAt(p.x, p.z));
  };

  const endA = heightAtEnd(-1);
  const endB = heightAtEnd(1);

  // The crown has to clear the water, measured from the chord rather than from
  // either end, because that is what the rise is added to.
  const chordMid = (endA + endB) / 2;
  const needed = WATER_LEVEL + CLEARANCE - chordMid;
  const rise = Math.max(MIN_RISE, needed);

  const profile: BridgeProfile = { endA, endB, rise, half };
  cache.set(s.id, profile);
  return profile;
}

/**
 * Deck height at a point along the span.
 *
 * `t` runs -1 at the local -Z end to +1 at the local +Z end. The arch is a
 * parabola that vanishes at both ends, so the deck meets its approaches
 * exactly however different their heights are — a linear chord plus `rise` at
 * the middle.
 */
export function bridgeDeckWorldY(profile: BridgeProfile, t: number): number {
  const clamped = t < -1 ? -1 : t > 1 ? 1 : t;
  const chord = profile.endA + (profile.endB - profile.endA) * ((clamped + 1) / 2);
  return chord + profile.rise * (1 - clamped * clamped);
}

/** The same, expressed in the structure's local frame for the mesh builder. */
export function bridgeDeckLocalY(s: Structure, profile: BridgeProfile, t: number): number {
  return bridgeDeckWorldY(profile, t) - s.y;
}

/**
 * Where along the span a world point falls, as `t` in -1..1, plus how far it
 * sits across the deck. Returns null when the point is off the bridge.
 */
export function bridgeParam(
  s: Structure,
  x: number,
  z: number,
  halfWidth: number
): { t: number; across: number } | null {
  const dx = x - s.x;
  const dz = z - s.z;
  const cos = Math.cos(s.rotation);
  const sin = Math.sin(s.rotation);
  // Inverse of the local->world mapping above.
  const along = dx * sin + dz * cos;
  const across = dx * cos - dz * sin;

  const profile = bridgeProfile(s);
  if (Math.abs(along) > profile.half) return null;
  if (Math.abs(across) > halfWidth) return null;
  return { t: along / profile.half, across };
}

/** Clears the memo. Only needed if the world is ever regenerated in-process. */
export function resetBridgeProfiles(): void {
  cache.clear();
}
