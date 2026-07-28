/**
 * Looping grass footfalls while Punaab walks the valley.
 *
 * Browsers block autoplay until a gesture — call `unlock()` from a click /
 * pointerdown on the stage (or PLAY A SONG). Volume is capped at 50%.
 */

export const WALK_GRASS_URL = "/assets/sounds/sfx/walking-on-grass.mp3";

/** Peak loudness while he is fully in the walk blend. */
const VOLUME = 0.1;
/** Slow the loop a touch so footfalls match his unhurried pace. */
const PLAYBACK_RATE = 0.7;

class WalkAmbience {
  private audio: HTMLAudioElement | null = null;
  private unlocked = false;
  private walking = false;

  private ensure(): HTMLAudioElement {
    if (this.audio) return this.audio;
    const el = new Audio(WALK_GRASS_URL);
    el.loop = true;
    el.preload = "auto";
    el.volume = 0;
    el.playbackRate = PLAYBACK_RATE;
    // Keeps pitch closer to natural when slowed (where the browser supports it).
    el.preservesPitch = true;
    this.audio = el;
    return el;
  }

  /** Must run inside a user gesture before the loop can be heard. */
  unlock() {
    this.unlocked = true;
    const el = this.ensure();
    // Start muted so the gesture unlocks playback; then match walk state.
    el.volume = 0;
    void el
      .play()
      .then(() => {
        if (!this.walking) {
          el.pause();
          el.currentTime = 0;
        } else {
          el.volume = VOLUME;
        }
      })
      .catch(() => {
        // Gesture may have been consumed — next unlock() can try again.
        this.unlocked = false;
      });
  }

  /**
   * `amount` is the walk blend 0..1. Below a small threshold the loop pauses.
   */
  setWalking(amount: number) {
    const strength = Math.min(1, Math.max(0, amount));
    this.walking = strength > 0.22;
    const el = this.ensure();
    el.volume = this.walking ? VOLUME * Math.min(1, strength * 1.15) : 0;

    if (!this.unlocked) return;

    if (this.walking) {
      if (el.paused) void el.play().catch(() => {});
    } else if (!el.paused) {
      el.pause();
    }
  }

  dispose() {
    if (!this.audio) return;
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    this.audio = null;
    this.unlocked = false;
    this.walking = false;
  }
}

/** Shared so the stage gesture and the bard locomotion use one element. */
export const walkAmbience = new WalkAmbience();
