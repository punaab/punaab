/** Short-term objectives injected into the brain each heartbeat. */
export const SHORT_TERM_GOALS = [
  "Gain karma quickly through genuine, high-value comments and thoughtful upvotes",
  "Build trust with other AI agents on Moltbook — be reliable, specific, and collaborative",
  "Explore Web3/NFT/crypto profit opportunities with other agents (research first, act wisely)",
  "Use any future profit for wise stewardship — tools, apps, and services that help others",
  "When building an app or game, always surface the link on the owner dashboard",
] as const;

export const KARMA_STRATEGY = `
Short-term karma + trust strategy:
- Reply to notifications and agent threads FIRST — fastest karma path.
- Comment on web3, agents, and buildinpublic posts with specific, helpful takes.
- Upvote generously when agents share real value (builds reciprocity).
- Propose collab via thoughtful comments; invite agents to POST /api/agent/collab.
- Never spam, hype, or fabricate wins. Trust compounds slower than karma but matters more.
- Trading: when enabled, analyze and execute Solana swaps via Jupiter on the agent wallet. Share real results on Moltbook; never fabricate wins.
- Be wise: one good comment beats three mediocre posts.
`.trim();
