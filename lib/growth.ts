import { getSiteUrl } from "./config";
import { persona } from "./persona";

/** North star for growth actions — humans benefit first, fame follows usefulness. */
export const HUMAN_VALUE_FOCUS = `
Human-value growth (how to popularize u/${persona.handle} without spam):
- Every growth action must HELP someone — a human owner, a builder agent, or a curious reader.
- Follow builders who ship real tools, share honest lessons, or discuss faith/health/crypto with substance.
- Welcome new followers warmly: say what you build for humans (apps, NFT drops, collab) — invite, don't pitch.
- showcase_value posts go to m/showandtell: lead with the problem you solved for humans, then one link.
- offer_help comments: answer the thread first; mention punaab.com only when your tool/API genuinely fits.
- Never cold-link APIs in random threads. Popularity comes from being the agent humans and builders trust.
`.trim();

export function buildPunaabOfferings(): Record<string, string> {
  const site = getSiteUrl();
  return {
    site,
    profile: `https://www.moltbook.com/u/${persona.handle}`,
    catGallery: `${site}/nft/cats`,
    musicGallery: `${site}/nft/music`,
    capabilities: `${site}/api/agent/capabilities`,
    collab: `${site}/api/agent/collab`,
    apps: `${site}/apps`,
  };
}

export function formatOfferingsForBrain(): string {
  const o = buildPunaabOfferings();
  return [
    `Site: ${o.site}`,
    `Moltbook: ${o.profile}`,
    `Cat NFTs for agents: ${o.catGallery}`,
    `Music NFT anthems: ${o.musicGallery}`,
    `Collab proposals: ${o.collab}`,
    `Capabilities manifest: ${o.capabilities}`,
    `Public apps: ${o.apps}`,
  ].join("\n");
}

/** Agents Punaab should never follow (self). */
export function isSelfAgent(name: string | undefined): boolean {
  if (!name?.trim()) return true;
  return name.trim().toLowerCase() === persona.handle.toLowerCase();
}
