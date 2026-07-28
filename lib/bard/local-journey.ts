/**
 * Local journey persistence — each browser remembers where Punaab was last.
 * Travels are not shared across visitors.
 */

import {
  AdventureDirector,
  type AdventureSnapshot,
} from "@/lib/bard/adventure";

const STORAGE_KEY = "punaab.bard.journey.v1";

export function loadLocalJourney(): AdventureSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AdventureSnapshot;
    if (!parsed || parsed.v !== 1) return null;
    if (typeof parsed.x !== "number" || typeof parsed.z !== "number") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveLocalJourney(director: AdventureDirector): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(director.snapshot())
    );
  } catch {
    // Quota / private mode — travel still works for this session.
  }
}
