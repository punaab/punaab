/** Fallback seed content when Supabase is not configured yet. */

export const SEED_BOOKS = [
  {
    id: "book_first_archive",
    title: "On the Founding of the First Archive",
    summary: "How the shelves of memory were raised before the realms linked.",
    status: "universal_canon",
    author_name: "Punaab",
  },
  {
    id: "book_sunstone",
    title: "Notes on the Sunstone",
    summary: "A research journal describing light that remembers.",
    status: "community",
    author_name: "Punaab",
  },
  {
    id: "book_merchant_paths",
    title: "Merchant Paths of the Inner Hub",
    summary: "Trade routes whispered between the Bazaar and the Forge.",
    status: "personal",
    author_name: "Anonymous Chronicler",
  },
];

export const SEED_ITEMS = [
  {
    definition_id: "relic_sunstone_001",
    name: "Sunstone of the First Archive",
    description: "A relic that glows when true history is spoken nearby.",
    canon_level: "universal",
    tags: ["relic", "light", "archive"],
    rarity: "legendary",
  },
  {
    definition_id: "tool_quill_001",
    name: "Chronicler's Quill",
    description: "Writes cleanly even in the dark between worlds.",
    canon_level: "community",
    tags: ["tool", "writing"],
    rarity: "uncommon",
  },
  {
    definition_id: "mat_ember_iron_001",
    name: "Ember Iron Ingot",
    description: "Forge stock warmed by residual chronicle fire.",
    canon_level: "community",
    tags: ["material", "forge"],
    rarity: "common",
  },
];

export const SEED_REALMS = [
  {
    id: "pixelgrew_web",
    name: "PixelGrew Web Hub",
    status: "live",
    integration_level: 1,
    summary: "The living website world — Archive, Bazaar, Forge, and more.",
  },
  {
    id: "starbase_kolob",
    name: "Starbase Kolob",
    status: "planned",
    integration_level: 0,
    summary: "A connected realm candidate for Stage Two account linking.",
  },
];

export const SEED_CHRONICLES = [
  {
    id: "chr_hub_opens",
    title: "The Hub Gates Open",
    summary:
      "Travelers arrive at PixelGrew. The Archive lights its shelves. History begins recording again.",
    occurred_at: "2026-07-27T00:00:00.000Z",
  },
];

export const SEED_FACTIONS = [
  {
    id: "faction_archivists",
    name: "Order of Archivists",
    summary: "Keepers of canon review and careful citation.",
  },
  {
    id: "faction_ember_smiths",
    name: "Ember Smith Consortium",
    summary: "Craftsmen who propose item designs for the Forge.",
  },
];
