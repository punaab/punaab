/**
 * Paths for the authored Punaab GLBs.
 *
 * Idle / walk / strum-idle share the same Meshy biped skeleton; we load the
 * idle file as the skinned mesh and play clips from any of them on one
 * AnimationMixer. Songs always use standing strum — there is no strum-walk.
 */

export const PUNAAB_IDLE_URL = "/assets/models/punaab-idle.glb";
export const PUNAAB_WALK_URL = "/assets/models/punaab-walk.glb";
export const PUNAAB_STRUM_IDLE_URL = "/assets/models/punaab-strum-idle.glb";
/** Prop held in his arms while a song is playing. */
export const PUNAAB_LOOT_URL = "/assets/models/loot.glb";
/** Pack worn on his back while he travels. */
export const PUNAAB_BACKPACK_URL = "/assets/models/backpack.glb";

/** Rough standing height in metres — used to frame the turntable preview. */
export const PUNAAB_HEIGHT = 1.7;
