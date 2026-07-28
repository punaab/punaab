/**
 * Shared boot-progress clock for the valley loader.
 *
 * The lazy chunk paints one loader, then BardWorld mounts another. Keeping the
 * value in module scope means the bar does not snap back to 0% on that handoff.
 */

/** Soft ceiling while the scene is still coming up. */
export const VALLEY_BOOT_CEILING = 92;

/**
 * Target seconds to reach the ceiling on a typical core boot (grass + bard).
 * The bar walks at ceiling/duration — steady, not tied to asset spikes.
 */
export const VALLEY_BOOT_DURATION_SEC = 3.2;

/** Percent per second while waiting on the scene. */
export const VALLEY_BOOT_RATE =
  VALLEY_BOOT_CEILING / VALLEY_BOOT_DURATION_SEC;

/** Percent per second once the scene is ready (finish to 100). */
export const VALLEY_BOOT_FINISH_RATE = 80;

let progress = 0;

export function getValleyBootProgress(): number {
  return progress;
}

export function setValleyBootProgress(value: number): void {
  progress = Math.max(0, Math.min(100, value));
}
