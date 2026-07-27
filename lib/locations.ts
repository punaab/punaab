export type LocationSlug =
  | "archive"
  | "bazaar"
  | "forge"
  | "council"
  | "realms"
  | "chronicle"
  | "guilds";

export type Location = {
  slug: LocationSlug;
  name: string;
  tagline: string;
  description: string;
  href: string;
  accent: string;
  guestAllowed: boolean;
};

export const LOCATIONS: Location[] = [
  {
    slug: "archive",
    name: "The Archive",
    tagline: "Books, journals, prophecies",
    description:
      "Read historical records, player journals, and official lore. Publish your own writings when ready.",
    href: "/archive",
    accent: "#67e8f9",
    guestAllowed: true,
  },
  {
    slug: "bazaar",
    name: "The Bazaar",
    tagline: "Buy, sell, trade, commission",
    description:
      "Trade goods, browse stalls, and commission crafts. Stage One shows inventory and listings stubs.",
    href: "/bazaar",
    accent: "#fbbf24",
    guestAllowed: false,
  },
  {
    slug: "forge",
    name: "The Forge",
    tagline: "Craft and design items",
    description:
      "Craft from recipes and submit new item designs into the universal registry.",
    href: "/forge",
    accent: "#fb7185",
    guestAllowed: false,
  },
  {
    slug: "council",
    name: "The Council",
    tagline: "Votes and world decisions",
    description:
      "Signal on discoveries, laws, and faction matters. Money never buys canon votes.",
    href: "/council",
    accent: "#c084fc",
    guestAllowed: false,
  },
  {
    slug: "realms",
    name: "Hall of Realms",
    tagline: "Connected games",
    description:
      "Enter linked realms and see what is happening across the shared universe.",
    href: "/realms",
    accent: "#86efac",
    guestAllowed: true,
  },
  {
    slug: "chronicle",
    name: "The Chronicle",
    tagline: "History forming live",
    description:
      "Watch verified events become permanent history — participants, items, and consequences.",
    href: "/chronicle",
    accent: "#a78bfa",
    guestAllowed: true,
  },
  {
    slug: "guilds",
    name: "Guild District",
    tagline: "Factions and companies",
    description:
      "Join factions, businesses, churches, nations, research groups, or adventuring companies.",
    href: "/guilds",
    accent: "#67e8f9",
    guestAllowed: false,
  },
];

export const PROFESSIONS = [
  { id: "chronicler", name: "Chronicler", blurb: "Writes books and records events." },
  { id: "relic_hunter", name: "Relic Hunter", blurb: "Discovers items in connected games." },
  { id: "smith", name: "Smith", blurb: "Creates item designs and recipes." },
  { id: "merchant", name: "Merchant", blurb: "Operates stores and trade routes." },
  { id: "archivist", name: "Archivist", blurb: "Reviews and categorizes lore." },
  { id: "diplomat", name: "Diplomat", blurb: "Represents factions and realms." },
  { id: "developer", name: "Developer", blurb: "Creates a game connected to the universe." },
  { id: "warden", name: "Warden", blurb: "Moderates content and investigates cheating." },
] as const;
