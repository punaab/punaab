/**
 * Shared boot clock for the valley loader.
 *
 * Progress is a slow asymptotic climb that never quite reaches the soft
 * ceiling — so the bar and % keep inching forward on long loads instead of
 * parking at 93% until the scene is ready.
 */

/** Soft ceiling until the scene signals ready (never quite arrives). */
export const VALLEY_BOOT_CEILING = 97;

/**
 * Time constant (seconds) for the main climb — larger = slower, steadier.
 *
 * Tuned to the honest length of a boot. At 24s the bar was still down in the
 * teens when the valley was already drawn, so the drain below had to cover
 * eighty points and the whole thing read as slow even when it was not.
 */
export const VALLEY_BOOT_TAU_SEC = 9;

/**
 * How long the final drain from current → 100% takes once the scene is up.
 *
 * This is pure waiting: the valley is behind the loader, finished, for every
 * millisecond of it. Long enough to read as a fill, short enough not to be a
 * toll — the enrichment pass still has this plus the fade to mount under cover.
 */
export const VALLEY_BOOT_FINISH_MS = 480;

let bootStartedAt = 0;
let finished = false;
/** Extra target from real milestones — kept small so we don't slam the ceiling. */
let milestoneBoost = 0;

export function ensureValleyBootClock(): number {
  if (!bootStartedAt) bootStartedAt = performance.now();
  return Math.max(0, (performance.now() - bootStartedAt) / 1000);
}

export function resetValleyBootClock(): void {
  bootStartedAt = 0;
  finished = false;
  milestoneBoost = 0;
}

/** Nudge the predicted bar when something real happens (chunk / WebGL up). */
export function bumpValleyBoot(amount = 3): void {
  milestoneBoost = Math.min(7, milestoneBoost + Math.max(0, amount));
}

export function markValleyBootFinished(): void {
  finished = true;
}

export function isValleyBootFinished(): boolean {
  return finished;
}

/**
 * Predicted wait percent — always increasing, never hard-stops at one number.
 *
 * Asymptotic toward CEILING with a little early pep so the first seconds still
 * feel alive. Derivative stays positive for the whole wait.
 */
export function valleyBootWaitPercent(elapsedSec: number): number {
  const t = Math.max(0, elapsedSec);
  const ceil = VALLEY_BOOT_CEILING;
  const tau = VALLEY_BOOT_TAU_SEC;

  // Main climb: ~37% of ceiling at τ, ~63% at 1.6τ, ~86% at 3τ, …
  const climb = ceil * (1 - Math.exp(-t / tau));
  // Brief early lift that fades — readable motion without racing to 90%.
  const pep = 10 * (1 - Math.exp(-t / 2.2)) * Math.exp(-t / 16);

  // Leave a hair under the ceiling so crawl never "arrives" and freezes.
  return Math.min(ceil - 0.45, climb + pep + milestoneBoost);
}
