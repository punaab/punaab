/**
 * Paths for the authored Punaab GLBs.
 *
 * The valley stage still uses the lighter idle / walk / strum packs for
 * animation. The public download shelf ships static mesh packs at 2K / 4K / 8K
 * plus props and a reference still.
 */

export const PUNAAB_IDLE_URL = "/assets/models/punaab-idle.glb";
export const PUNAAB_WALK_URL = "/assets/models/punaab-walk.glb";
export const PUNAAB_STRUM_IDLE_URL = "/assets/models/punaab-strum-idle.glb";
/** Prop held in his arms while a song is playing. */
export const PUNAAB_LOOT_URL = "/assets/models/loot.glb";
/** Pack worn on his back while he travels. */
export const PUNAAB_BACKPACK_URL = "/assets/models/backpack.glb";

/** Static download meshes (texture resolution in the filename). */
export const PUNAAB_STATIC_2K_URL = "/downloads/punaab_2k.glb";
export const PUNAAB_STATIC_4K_URL = "/downloads/punaab_4k.glb";
export const PUNAAB_STATIC_8K_URL = "/downloads/punaab_8k.glb";
export const PUNAAB_REFERENCE_IMAGE_URL = "/downloads/punaab_reference_image.png";
export const PUNAAB_BACKPACK_PREVIEW_URL = "/downloads/backpack.png";
export const PUNAAB_LUTE_PREVIEW_URL = "/downloads/lute.svg";

/** Rough standing height in metres — used to frame the turntable preview. */
export const PUNAAB_HEIGHT = 1.7;

export type PunaabDownloadId =
  | "2k"
  | "4k"
  | "8k"
  | "backpack"
  | "loot"
  | "reference";

export type PunaabDownloadItem = {
  id: PunaabDownloadId;
  url: string;
  filename: string;
  label: string;
  blurb: string;
  kind: "model" | "prop" | "image";
  /** Optional still used in the download shelf card. */
  preview?: string;
};

export const PUNAAB_DOWNLOADS: readonly PunaabDownloadItem[] = [
  {
    id: "2k",
    url: PUNAAB_STATIC_2K_URL,
    filename: "punaab_2k.glb",
    label: "Punaab 2K",
    blurb: "Static glTF · lighter textures for games and prototypes.",
    kind: "model",
  },
  {
    id: "4k",
    url: PUNAAB_STATIC_4K_URL,
    filename: "punaab_4k.glb",
    label: "Punaab 4K",
    blurb: "Static glTF · balanced detail for most engines.",
    kind: "model",
  },
  {
    id: "8k",
    url: PUNAAB_STATIC_8K_URL,
    filename: "punaab_8k.glb",
    label: "Punaab 8K",
    blurb: "Static glTF · highest texture detail.",
    kind: "model",
  },
  {
    id: "reference",
    url: PUNAAB_REFERENCE_IMAGE_URL,
    filename: "punaab_reference_image.png",
    label: "Reference image",
    blurb: "Still for shaders, textures, and concept work.",
    kind: "image",
    preview: PUNAAB_REFERENCE_IMAGE_URL,
  },
  {
    id: "backpack",
    url: PUNAAB_BACKPACK_URL,
    filename: "punaab_backpack.glb",
    label: "Backpack",
    blurb: "Travel pack prop — mount on his back.",
    kind: "prop",
    preview: PUNAAB_BACKPACK_PREVIEW_URL,
  },
  {
    id: "loot",
    url: PUNAAB_LOOT_URL,
    filename: "punaab_loot.glb",
    label: "Lute (loot)",
    blurb: "Instrument prop — the one he plays on the road.",
    kind: "prop",
    preview: PUNAAB_LUTE_PREVIEW_URL,
  },
] as const;
