/**
 * Jimothy & Limbothy universe — lore for LLM-crafted tweets (not copy-paste).
 * CA: 9CtQhxDcNd3nzHE2h6v2zc2STZKXT9MYwY2e3AWapump
 */

export const LIMBOTHY_MINT =
  "9CtQhxDcNd3nzHE2h6v2zc2STZKXT9MYwY2e3AWapump";

/** Canon for generating fresh posts — never tweet these lines verbatim. */
export const LIMBOTHY_LORE_BIBLE = `
The Tale of Jimothy & Limbothy — two primal meme buddies, playful opposites (not enemies).
Jimothy: raccoon, short little legs, curious FOMO energy, caffeine-powered, climbs garbage cans,
needs ladders, scurries with enthusiasm, portfolio measured in percentages. Lovable try-hard.
Limbothy: borzoi, legs so long nobody confirmed where they end, LONGO energy, stretches
once every six hours, steps over things by accident, sees far from altitude, portfolio
measured in leg length; scientists who tried to calculate his inseam got a recursive equation.
They tease each other like friends. Jimothy is earnest; Limbothy is serene and absurdly tall.
Prophecy (gentle joke): "When the short legs panic… the long legs prosper." — affectionate, not cruel.
Bit: Jimothy asks how Limbothy is always ahead → "Long-term thinking." / "No… long-leg thinking."
Tone: warm absurdist meme humor, buddy comedy, crypto-adjacent without hard sell. Never dunk on Jimothy.
`.trim();

/** Angle seeds so each craft request explores a different joke. */
export const LIMBOTHY_ANGLES: string[] = [
  "Limbothy's absurd height in a wholesome everyday scene",
  "buddy comedy: Jimothy and Limbothy helping each other somehow",
  "science lab fails to measure Limbothy (affectionate chaos)",
  "Limbothy stretch schedule as a power-up",
  "Jimothy discovers a ladder; Limbothy discovers a cloud",
  "candle chart sightlines / bull run altitude joke (gentle)",
  "portfolio units: percent vs inseam (playful, not mean)",
  "tiny wholesome dialogue between Jimothy and Limbothy",
  "Limbothy accidentally reaches a new floor / dimension",
  "one majestic step that solves a silly problem",
  "recursive inseam equation going feral (nerd joke)",
  "Limbothy-only observation — Jimothy optional cameo as a friend",
];

export function pickLimbothyAngle(): string {
  const noise = `${Date.now()}:${Math.random()}`;
  let h = 0;
  for (let i = 0; i < noise.length; i++) h = (h * 31 + noise.charCodeAt(i)) >>> 0;
  return LIMBOTHY_ANGLES[h % LIMBOTHY_ANGLES.length]!;
}
