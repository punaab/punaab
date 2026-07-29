/**
 * Shared boot-progress clock for the valley loader.
 *
 * The lazy chunk paints one loader, then BardWorld mounts another. Keeping the
 * value in module scope means the bar does not snap back to 0% on that handoff.
 */

/**
 * Soft asymptote while the scene is still coming up. The bar approaches this
 * continuously — never hard-stalls at a ceiling waiting on WebGL.
 */
export const VALLEY_BOOT_ASYMPTOTE = 97;

/**
 * Time constant (seconds) for the wait curve: ~63% of the way to the asymptote
 * after this many seconds of wall time. Tuned so a typical boot feels like a
 * steady fill rather than a sprint-then-freeze.
 */
export const VALLEY_BOOT_TAU_SEC = 3.4;

/** Percent per second once the scene is ready (finish to 100). */
export const VALLEY_BOOT_FINISH_RATE = 110;

let progress = 0;

export function getValleyBootProgress(): number {
  return progress;
}

export function setValleyBootProgress(value: number): void {
  progress = Math.max(0, Math.min(100, value));
}

/** Map wall-clock wait time onto a smooth curve toward the asymptote. */
export function valleyBootProgressAt(elapsedSec: number): number {
  const t = Math.max(0, elapsedSec);
  return (
    VALLEY_BOOT_ASYMPTOTE * (1 - Math.exp(-t / VALLEY_BOOT_TAU_SEC))
  );
}
