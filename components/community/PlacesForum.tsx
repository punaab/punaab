"use client";

import { CommunityForum } from "./CommunityForum";
import { PlacesMap } from "./PlacesMap";

/**
 * The Places area: the chart, wired to the forum's compose form.
 *
 * This wrapper exists purely to hold the boundary in the right place. The map
 * has to hand a location key to `CommunityForum`'s compose state, which means
 * passing it a callback — and a callback cannot cross from a Server Component
 * into a Client one. `/world/[id]` is a server page, so the composition has to
 * happen on the client side of the line, which is here.
 *
 * Keeping it in its own file rather than teaching `CommunityForum` about maps
 * also means the other seven categories never pull the cartography module —
 * and with it the whole terrain height function — into their bundle.
 */
export function PlacesForum() {
  return (
    <CommunityForum
      initialCategory="places"
      header={({ setLocationKey }) => (
        <PlacesMap onPropose={(key) => setLocationKey(key)} />
      )}
    />
  );
}
