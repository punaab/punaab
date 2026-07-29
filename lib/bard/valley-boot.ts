/**
 * Shared boot clock for the valley loader.
 *
 * The lazy chunk paints one loader, then BardWorld mounts another. A shared
 * start time lets progress resume mid-flight instead of restarting at 0%.
 */

/** Soft ceiling until the scene signals ready (then we finish to 100). */
export const VALLEY_BOOT_CEILING = 92;

/**
 * Asymptotic time constant in seconds.
 *
 * Progress = ceiling * (1 - e^(-t/τ)). Longer loads keep the bar creeping
 * toward the ceiling instead of slamming into 90% and sitting there.
 * At τ: ~63% of the ceiling; at 2τ: ~86%; at 3τ: ~95% of the ceiling.
 */
export const VALLEY_BOOT_TAU_SEC = 14;

/** How long the final drain from current → 100% takes once the scene is up. */
export const VALLEY_BOOT_FINISH_MS = 700;

let bootStartedAt = 0;
let finished = false;

export function ensureValleyBootClock(): number {
  if (!bootStartedAt) bootStartedAt = performance.now();
  return Math.max(0, (performance.now() - bootStartedAt) / 1000);
}

export function resetValleyBootClock(): void {
  bootStartedAt = 0;
  finished = false;
}

export function markValleyBootFinished(): void {
  finished = true;
}

export function isValleyBootFinished(): boolean {
  return finished;
}

/**
 * Display percent while waiting — one shared curve for fill, diamond, and label.
 * Creeps toward the soft ceiling; never arrives until `ready` finishes it.
 */
export function valleyBootWaitPercent(elapsedSec: number): number {
  const t = Math.max(0, elapsedSec);
  return VALLEY_BOOT_CEILING * (1 - Math.exp(-t / VALLEY_BOOT_TAU_SEC));
}
