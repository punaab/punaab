/**
 * Named appearances for Punaab.
 *
 * The ids line up with the `appearances` table seeded in
 * `supabase/migrations/001_punaab_core.sql`, so a project's stored
 * `appearance_id` maps straight onto a palette here with no translation table.
 */

import { DEFAULT_PALETTE, type BardPalette } from "./build-bard";

export type Appearance = {
  id: string;
  name: string;
  blurb: string;
  palette: BardPalette;
};

export const APPEARANCES: Appearance[] = [
  {
    id: "classic",
    name: "Classic Bard",
    blurb: "The traveling storyteller. Road dust and oxblood lining.",
    palette: DEFAULT_PALETTE,
  },
  {
    id: "wizard",
    name: "Wizard",
    blurb: "Arcane robes, a knowing smile you never quite see.",
    palette: {
      ...DEFAULT_PALETTE,
      cloak: "#1d2547",
      cloakLining: "#2b1f4d",
      hood: "#161c38",
      leather: "#3b3355",
      cloth: "#4a4470",
      metal: "#c9b458",
      eyes: "#9d8cff",
    },
  },
  {
    id: "cyberpunk",
    name: "Cyberpunk",
    blurb: "Neon strings and a chrome lute.",
    palette: {
      ...DEFAULT_PALETTE,
      cloak: "#16161d",
      cloakLining: "#0d3a44",
      hood: "#101018",
      leather: "#22222c",
      cloth: "#2c2c38",
      wood: "#3a3f4a",
      woodDark: "#1e2128",
      metal: "#8be9fd",
      eyes: "#ff4fd8",
    },
  },
  {
    id: "pixel",
    name: "Pixel",
    blurb: "Sixteen-bit palette for retro worlds.",
    palette: {
      ...DEFAULT_PALETTE,
      cloak: "#3b2f5e",
      cloakLining: "#7b3f61",
      hood: "#2e2549",
      leather: "#6b4a2f",
      cloth: "#5a7a4a",
      wood: "#b07a3c",
      metal: "#e8c46a",
      eyes: "#6ee7b7",
    },
  },
  {
    id: "pirate",
    name: "Pirate",
    blurb: "Sea shanties and a stolen map.",
    palette: {
      ...DEFAULT_PALETTE,
      cloak: "#2f2a24",
      cloakLining: "#6b2f26",
      hood: "#262119",
      leather: "#54331f",
      cloth: "#7a6a4e",
      metal: "#c9a227",
      eyes: "#f0c05a",
    },
  },
  {
    id: "christmas",
    name: "Winterfeast",
    blurb: "Seasonal cheer, snow on the shoulders.",
    palette: {
      ...DEFAULT_PALETTE,
      cloak: "#7a1f28",
      cloakLining: "#e8e2d4",
      hood: "#63161e",
      leather: "#4a3527",
      cloth: "#1f4a33",
      metal: "#e0c56b",
      eyes: "#a8e6cf",
    },
  },
  {
    id: "halloween",
    name: "Hallow's Eve",
    blurb: "Spooky tales by lantern light.",
    palette: {
      ...DEFAULT_PALETTE,
      cloak: "#1a1420",
      cloakLining: "#5a2d0a",
      hood: "#140f1a",
      leather: "#3a2418",
      cloth: "#2b2033",
      metal: "#d4762a",
      eyes: "#ff8c1a",
    },
  },
];

export function getAppearance(id: string | null | undefined): Appearance {
  return APPEARANCES.find((a) => a.id === id) ?? APPEARANCES[0];
}
