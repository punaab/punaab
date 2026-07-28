export const FEATURES = [
  "AI NPC*",
  "Sings & plays",
  "Merchant",
  "Lore & quests",
  "Free 3d Models",
  "Website embed",
  "OBS overlay",
  "Stream Chat",
] as const;

/** Footnote for starred features on the marketing page. */
export const FEATURES_NOTE =
  "* AI chat uses paid API usage — the model, project, lore, and the rest of Punaab stay free.";

export const DASHBOARD_NAV = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/projects", label: "Projects" },
  { href: "/dashboard/keys", label: "API Keys" },
  { href: "/dashboard/embeds", label: "Embeds & Streaming" },
  { href: "/dashboard/downloads", label: "Downloads" },
  { href: "/dashboard/billing", label: "Billing" },
  { href: "/dashboard/usage", label: "Usage" },
  { href: "/docs", label: "Docs" },
] as const;
