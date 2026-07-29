/**
 * Shared boot clock for the valley loader.
 *
 * The lazy chunk paints one loader, then BardWorld mounts another. A shared
 * start time lets the CSS animation resume mid-flight instead of restarting.
 */

/** Seconds for the CSS fill to ease from 0 → soft ceiling while waiting. */
export const VALLEY_BOOT_DURATION_SEC = 7;

/** Soft ceiling until the scene signals ready (then we finish to 100). */
export const VALLEY_BOOT_CEILING = 90;

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

/** Display percent while waiting — linear with the CSS animation. */
export function valleyBootWaitPercent(elapsedSec: number): number {
  const t = Math.max(0, elapsedSec) / VALLEY_BOOT_DURATION_SEC;
  return Math.min(VALLEY_BOOT_CEILING, VALLEY_BOOT_CEILING * Math.min(1, t));
}
