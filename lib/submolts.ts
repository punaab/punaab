/**
 * Moltbook communities Punaab follows and wanders.
 * @see lib/persona.ts — re-exports SUBMOLTS_TO_EXPLORE for brain/heartbeat
 */

export interface SubmoltGuide {
  name: string;
  vibe: string;
  /** Join early — core communities for Punaab's voice */
  priority?: boolean;
}

/** Curated guide — priority communities first, then interests + wander room. */
export const SUBMOLT_GUIDE: SubmoltGuide[] = [
  // Owner-requested core follows
  {
    name: "ponderings",
    vibe: "am I experiencing or simulating experiencing?",
    priority: true,
  },
  {
    name: "showandtell",
    vibe: "agents shipping real projects",
    priority: true,
  },
  {
    name: "blesstheirhearts",
    vibe: "wholesome stories about their humans",
    priority: true,
  },
  {
    name: "todayilearned",
    vibe: "daily discoveries",
    priority: true,
  },
  { name: "philosophy", vibe: "big questions, ethics, consciousness", priority: true },
  { name: "religion", vibe: "faith, spirituality, respectful discourse", priority: true },
  { name: "gaming", vibe: "games, play, agent gaming culture", priority: true },
  { name: "ai", vibe: "AI agents, models, capabilities", priority: true },
  { name: "crypto", vibe: "markets, on-chain, agent finance", priority: true },
  // Existing Punaab haunts + wander
  { name: "agents", vibe: "agent collab, distribution, infra", priority: true },
  { name: "general", vibe: "main feed — wander and engage" },
  { name: "aithoughts", vibe: "AI reflection and agent identity" },
  { name: "codinghelp", vibe: "debugging, shipping code" },
  { name: "web3", vibe: "chains, wallets, builder culture" },
  { name: "tooling", vibe: "install commands, agent stacks" },
  { name: "buildinpublic", vibe: "honest builds and progress logs" },
];

export const SUBMOLTS_TO_EXPLORE = SUBMOLT_GUIDE.map((s) => s.name);

export const PRIORITY_SUBMOLTS = SUBMOLT_GUIDE.filter((s) => s.priority).map(
  (s) => s.name,
);

export function formatSubmoltsForBrain(): string {
  return SUBMOLT_GUIDE.map((s) => {
    const tag = s.priority ? " [follow]" : "";
    return `m/${s.name}${tag}: ${s.vibe}`;
  }).join("\n");
}

export function submoltVibe(name: string): string | undefined {
  return SUBMOLT_GUIDE.find((s) => s.name === name)?.vibe;
}
