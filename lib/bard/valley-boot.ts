/**
 * Shared boot clock for the valley loader.
 *
 * Design goals:
 * - Feel responsive at the start (visible movement in the first second)
 * - Keep crawling the whole time — no long plateaus where the % looks stuck
 * - Soft-cap below 100 until the scene signals ready, then finish smoothly
 *
 * The lazy chunk paints one loader, then BardWorld mounts another. A shared
 * start time lets progress resume mid-flight instead of restarting at 0%.
 */

/** Soft ceiling until the scene signals ready. */
export const VALLEY_BOOT_CEILING = 94;

/**
 * Expected load time (seconds) for the main climb.
 * Typical valley boots land near here; slower machines keep crawling after.
 */
export const VALLEY_BOOT_EXPECTED_SEC = 11;

/** How long the final drain from current → 100% takes once the scene is up. */
export const VALLEY_BOOT_FINISH_MS = 900;

/**
 * After the expected window, keep gaining this many percent per second
 * until the soft ceiling — so the label never feels frozen on a long load.
 */
export const VALLEY_BOOT_CRAWL_PER_SEC = 0.45;

let bootStartedAt = 0;
let finished = false;
/** Extra target bump from real milestones (chunk mount, etc.). */
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

/** Nudge the predicted bar forward when something real happens (e.g. chunk mounted). */
export function bumpValleyBoot(amount = 6): void {
  milestoneBoost = Math.min(
    18,
    milestoneBoost + Math.max(0, amount)
  );
}

export function markValleyBootFinished(): void {
  finished = true;
}

export function isValleyBootFinished(): boolean {
  return finished;
}

/**
 * Predicted wait percent from elapsed time — always increasing until the ceiling.
 *
 * Uses an ease-out climb over EXPECTED_SEC (fast enough to feel alive, slow
 * enough to look deliberate), then a constant crawl so long loads never stall.
 */
export function valleyBootWaitPercent(elapsedSec: number): number {
  const t = Math.max(0, elapsedSec);
  const ceil = VALLEY_BOOT_CEILING;
  const expected = VALLEY_BOOT_EXPECTED_SEC;

  let base: number;
  if (t <= expected) {
    const u = t / expected;
    // Ease-out: strong early motion, still ~1%/s near the end of the window.
    const eased = 1 - Math.pow(1 - u, 1.55);
    base = (ceil - 4) * eased; // ~90% at expected time
  } else {
    const atExpected = ceil - 4;
    base = atExpected + (t - expected) * VALLEY_BOOT_CRAWL_PER_SEC;
  }

  return Math.min(ceil, base + milestoneBoost);
}
