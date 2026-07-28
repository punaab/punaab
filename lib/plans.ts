export type PlanCode = "free" | "creator" | "studio" | "enterprise";

/**
 * What a plan unlocks beyond raw credits.
 *
 * Kept as explicit flags rather than inferred from the plan's rank, so adding
 * a tier or moving a feature between tiers is a one-line change here and every
 * gate in the app follows automatically.
 */
export type PlanCapabilities = {
  /** Embed the bard on your own website via a script tag. */
  websiteEmbed: boolean;
  /** Transparent browser-source overlay for OBS / Streamlabs. */
  obsOverlay: boolean;
  /** Bridge Twitch chat into the bard. */
  twitchChat: boolean;
  /** Bridge Kick chat into the bard. */
  kickChat: boolean;
  /** How many embed tokens can exist at once. */
  embedTokens: number;
  /** How many live chat channels can be bridged at once. */
  chatBridges: number;
};

export type PlanDefinition = {
  code: PlanCode;
  name: string;
  priceLabel: string;
  priceMonthlyUsd: number;
  projects: number | "unlimited";
  creditsMonthly: number | "unlimited";
  features: string[];
  capabilities: PlanCapabilities;
  envPriceId: string | null;
  highlighted?: boolean;
};

const NO_CAPABILITIES: PlanCapabilities = {
  websiteEmbed: false,
  obsOverlay: false,
  twitchChat: false,
  kickChat: false,
  embedTokens: 0,
  chatBridges: 0,
};

export const PLANS: PlanDefinition[] = [
  {
    code: "free",
    name: "Free",
    priceLabel: "$0/mo",
    priceMonthlyUsd: 0,
    projects: 1,
    creditsMonthly: 500,
    features: [
      "1 project",
      "500 cloud credits / month",
      "Godot plugin + 3D model download",
      "Basic AI, radio, merchant",
      "Community support",
    ],
    capabilities: NO_CAPABILITIES,
    envPriceId: null,
  },
  {
    code: "creator",
    name: "Creator",
    priceLabel: "$19/mo",
    priceMonthlyUsd: 19,
    projects: 10,
    creditsMonthly: 25_000,
    features: [
      "10 projects",
      "25,000 credits / month",
      "Embed Punaab on your own site",
      "OBS overlay + Twitch & Kick chat",
      "Advanced AI + music streaming",
    ],
    capabilities: {
      websiteEmbed: true,
      obsOverlay: true,
      twitchChat: true,
      kickChat: true,
      embedTokens: 3,
      chatBridges: 2,
    },
    envPriceId: "STRIPE_PRICE_CREATOR",
    highlighted: true,
  },
  {
    code: "studio",
    name: "Studio",
    priceLabel: "$99/mo",
    priceMonthlyUsd: 99,
    projects: "unlimited",
    creditsMonthly: 250_000,
    features: [
      "Unlimited projects",
      "250,000 credits / month",
      "Unlimited embeds + stream overlays",
      "Team members (soon)",
      "Priority support + marketplace access",
    ],
    capabilities: {
      websiteEmbed: true,
      obsOverlay: true,
      twitchChat: true,
      kickChat: true,
      embedTokens: 25,
      chatBridges: 15,
    },
    envPriceId: "STRIPE_PRICE_STUDIO",
  },
  {
    code: "enterprise",
    name: "Enterprise",
    priceLabel: "Custom",
    priceMonthlyUsd: 0,
    projects: "unlimited",
    creditsMonthly: "unlimited",
    features: [
      "Dedicated infrastructure",
      "SLA + private hosting",
      "White label embeds",
      "Custom integrations",
    ],
    capabilities: {
      websiteEmbed: true,
      obsOverlay: true,
      twitchChat: true,
      kickChat: true,
      embedTokens: 500,
      chatBridges: 500,
    },
    envPriceId: null,
  },
];

export const DIALOGUE_CREDIT_COST = 2;

export function getStripePriceId(plan: PlanDefinition): string | null {
  if (!plan.envPriceId) return null;
  return process.env[plan.envPriceId] || null;
}

export function projectLimit(plan: PlanCode): number {
  if (plan === "free") return 1;
  if (plan === "creator") return 10;
  return 10_000;
}

export function getPlan(code: string | null | undefined): PlanDefinition {
  return PLANS.find((p) => p.code === code) ?? PLANS[0];
}

/** Capabilities for a plan code. Unknown codes fall back to Free. */
export function capabilitiesFor(code: string | null | undefined): PlanCapabilities {
  return getPlan(code).capabilities;
}

/** Credit cost of one live-chat reply. Cheaper than a full game dialogue turn. */
export const EMBED_CHAT_CREDIT_COST = 1;
